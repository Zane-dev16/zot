/**
 * App-level flow: pair -> list -> composer -> unpair, plus the inert baked hook.
 * Native modules are stubbed globally in jest.setup.js; transport and the stream
 * connector are injected so this runs headless on Linux.
 *
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import App from '../App';
import type { SessionDeps } from '../src/session/SessionProvider';
import { createMemoryTokenStore } from '../src/api/client';
import type { HostStore } from '../src/api/client';
import { setBakedPairSource } from '../src/api/baked';
import type { StreamHandle } from '../src/api/stream';
import { fakeRouterTransport, pathOf } from '../test-support/fakes';
import type { FakeResponse } from '../test-support/fakes';

type Renderer = ReactTestRenderer.ReactTestRenderer;

function stubConnector() {
  const stopped: boolean[] = [];
  const connectStreamFn = (): StreamHandle => ({
    async start() {},
    stop() {
      stopped.push(true);
    },
    status: () => 'stopped',
    since: () => null,
  });
  return { stopped, connectStreamFn };
}

function daemon(overrides: Record<string, FakeResponse> = {}) {
  const runs = [
    { id: 'r1', title: 'hello', prompt: 'say hi', state: 'queued' },
  ];
  return fakeRouterTransport(call => {
    const key = call.method + ' ' + pathOf(call.url);
    if (overrides[key]) return overrides[key] as FakeResponse;
    if (key === 'POST /api/v1/pair/confirm') {
      return { status: 201, payload: { token: 'tok-1' } };
    }
    if (key === 'GET /api/v1/runs') {
      return { status: 200, payload: { runs } };
    }
    if (key === 'POST /api/v1/runs') {
      return {
        status: 201,
        payload: {
          run: { id: 'r2', title: 'derived', prompt: 'p', state: 'queued' },
        },
      };
    }
    return { status: 404, payload: { error: 'not found' } };
  });
}

async function renderApp(deps: SessionDeps): Promise<Renderer> {
  const box: { current: Renderer | null } = { current: null };
  await ReactTestRenderer.act(async () => {
    box.current = ReactTestRenderer.create(<App deps={deps} />);
  });
  // Flush the launch hydrate + any follow-up state updates.
  await ReactTestRenderer.act(async () => {
    await Promise.resolve();
  });
  const app = box.current;
  if (app === null) throw new Error('no renderer');
  return app;
}

async function flush(): Promise<void> {
  await ReactTestRenderer.act(async () => {
    await Promise.resolve();
  });
}

async function press(renderer: Renderer, testID: string): Promise<void> {
  await ReactTestRenderer.act(async () => {
    renderer.root.findByProps({ testID }).props.onPress();
  });
}

async function type(renderer: Renderer, testID: string, value: string) {
  await ReactTestRenderer.act(async () => {
    renderer.root.findByProps({ testID }).props.onChangeText(value);
  });
}

function exists(renderer: Renderer, testID: string): boolean {
  return renderer.root.findAllByProps({ testID }).length > 0;
}

afterEach(() => {
  setBakedPairSource(null);
});

test('renders the pair screen when the keychain is empty', async () => {
  const app = await renderApp({
    tokenStore: createMemoryTokenStore(),
    transport: daemon().transport,
    connectStreamFn: stubConnector().connectStreamFn,
  });
  expect(exists(app, 'pair-code')).toBe(true);
  expect(exists(app, 'runs-list')).toBe(false);
});

test('shows neither screen until the keychain read resolves', async () => {
  // A slow keychain must not flash the pair screen at a paired user. Before the
  // hydrated gate, the first frame rendered PairScreen because token was null.
  let release: ((token: string | null) => void) | null = null;
  const slowStore = {
    async saveToken() {},
    async loadToken() {
      return await new Promise<string | null>(resolve => {
        release = resolve;
      });
    },
    async deleteToken() {},
  };

  const app = await renderApp({
    tokenStore: slowStore,
    transport: daemon().transport,
    connectStreamFn: stubConnector().connectStreamFn,
    // The stub stream never reports live, so polling would leave a timer behind.
    pollMs: 0,
  });

  expect(release).not.toBeNull();
  expect(exists(app, 'pair-code')).toBe(false);
  expect(exists(app, 'runs-list')).toBe(false);

  // The token was there all along: once the read lands, the list renders and
  // the pair screen is never shown.
  await ReactTestRenderer.act(async () => {
    (release as unknown as (token: string | null) => void)('tok-1');
    await Promise.resolve();
  });
  await flush();
  expect(exists(app, 'runs-list')).toBe(true);
  expect(exists(app, 'pair-code')).toBe(false);
});

test('a stored host with no token shows in the pair field', async () => {
  // Wildcard signing: the keychain item cannot be read, so no token loads, but
  // the host was persisted. useState(state.host) froze the pre-hydrate default,
  // so the field showed the wrong server and a retry would pair against it.
  const hostStore: HostStore = {
    async loadHost() {
      return 'http://10.0.0.9:9100';
    },
    async saveHost() {},
    async clearHost() {},
  };
  const app = await renderApp({
    tokenStore: createMemoryTokenStore(),
    hostStore,
    transport: daemon().transport,
    connectStreamFn: stubConnector().connectStreamFn,
  });

  expect(exists(app, 'pair-code')).toBe(true);
  expect(app.root.findByProps({ testID: 'pair-host' }).props.value).toBe(
    'http://10.0.0.9:9100',
  );
});

test('pairs, lists runs, sends a prompt and unpairs', async () => {
  const fake = daemon();
  const store = createMemoryTokenStore();
  const connector = stubConnector();
  const app = await renderApp({
    tokenStore: store,
    transport: fake.transport,
    connectStreamFn: connector.connectStreamFn,
    pollMs: 0,
  });

  await type(app, 'pair-host', '127.0.0.1:8787');
  await type(app, 'pair-code', '123456');
  await press(app, 'pair-submit');

  // Pair confirmed against the normalized host, token saved, runs loaded.
  expect(fake.calls[0].url).toBe('http://127.0.0.1:8787/api/v1/pair/confirm');
  expect(await store.loadToken()).toBe('tok-1');
  expect(exists(app, 'runs-list')).toBe(true);
  // View forwards testID to its host node, so match on presence, not count.
  expect(app.root.findAllByProps({ testID: 'run-r1' }).length).toBeGreaterThan(
    0,
  );

  // Composer: blank title -> derived from the prompt (Swift parity).
  await type(app, 'composer-prompt', '  say hi  ');
  await press(app, 'composer-send');
  const posts = fake.calls.filter(call => call.method === 'POST');
  expect(posts[1].body).toBe('{"title":"say hi","prompt":"say hi"}');
  expect(app.root.findByProps({ testID: 'composer-prompt' }).props.value).toBe(
    '',
  );

  // Refresh re-reads the list.
  const before = fake.calls.length;
  await press(app, 'runs-refresh');
  expect(fake.calls.length).toBe(before + 1);

  // Unpair clears the keychain token and returns to the pair screen.
  await press(app, 'runs-unpair');
  expect(await store.loadToken()).toBe(null);
  expect(exists(app, 'pair-code')).toBe(true);
  expect(exists(app, 'runs-list')).toBe(false);
  // A host the user typed survives signOut's reset to the default host.
  expect(app.root.findByProps({ testID: 'pair-host' }).props.value).toBe(
    '127.0.0.1:8787',
  );
});

test('a bad code shows one error line and never calls the daemon', async () => {
  const fake = daemon();
  const app = await renderApp({
    tokenStore: createMemoryTokenStore(),
    transport: fake.transport,
    connectStreamFn: stubConnector().connectStreamFn,
  });

  await type(app, 'pair-code', '12345');
  await press(app, 'pair-submit');

  expect(fake.calls).toHaveLength(0);
  expect(
    String(app.root.findByProps({ testID: 'pair-error' }).props.children),
  ).toBe('Code must be 6 digits.');
});

test('baked pair hook is inert without a native source (T5)', async () => {
  const fake = daemon();
  await ReactTestRenderer.act(async () => {
    ReactTestRenderer.create(
      <App
        deps={{
          tokenStore: createMemoryTokenStore(),
          transport: fake.transport,
          connectStreamFn: stubConnector().connectStreamFn,
        }}
      />,
    );
  });
  expect(fake.calls).toHaveLength(0);
});

test('a baked source seeds the pair screen and attempts pairing once', async () => {
  const fake = daemon({
    'POST /api/v1/pair/confirm': {
      status: 400,
      payload: { error: 'bad or expired code' },
    },
  });
  setBakedPairSource({
    isBaked: true,
    config: () => ({ serverURL: '192.168.68.56:8787', code: '123456' }),
  });
  const app = await renderApp({
    tokenStore: createMemoryTokenStore(),
    transport: fake.transport,
    connectStreamFn: stubConnector().connectStreamFn,
  });

  await flush();
  expect(fake.calls).toHaveLength(1);
  expect(fake.calls[0].url).toBe(
    'http://192.168.68.56:8787/api/v1/pair/confirm',
  );
  expect(
    String(app.root.findByProps({ testID: 'pair-error' }).props.children),
  ).toBe('bad or expired code');
  expect(app.root.findByProps({ testID: 'pair-code' }).props.value).toBe(
    '123456',
  );
});
