import { createMemoryTokenStore } from '../src/api/client';
import {
  createSessionController,
  DEFAULT_HOST,
  FETCH_ERROR,
  PAIR_ERROR_FALLBACK,
  SEND_ERROR,
} from '../src/session/sessionController';
import { INVALID_HOST_ERROR, PAIR_CODE_ERROR } from '../src/session/validation';
import { fakeRouterTransport, pathOf } from '../test-support/fakes';
import type { FakeResponse } from '../test-support/fakes';

const RUN = { id: 'r1', title: 'hello', prompt: 'say hi', state: 'queued' };

function daemon(overrides: Record<string, FakeResponse> = {}) {
  return fakeRouterTransport(call => {
    const path = pathOf(call.url);
    const key = call.method + ' ' + path;
    if (overrides[key]) return overrides[key] as FakeResponse;
    if (key === 'POST /api/v1/pair/confirm') {
      return { status: 201, payload: { token: 'tok-1', device: { id: 'd1' } } };
    }
    if (key === 'GET /api/v1/runs') {
      return { status: 200, payload: { runs: [RUN] } };
    }
    if (key === 'POST /api/v1/runs') {
      return { status: 201, payload: { run: RUN } };
    }
    return { status: 404, payload: { error: 'not found' } };
  });
}

describe('pair (ios/ContentView.swift:78-94)', () => {
  test('rejects a non-6-digit code before any network call', async () => {
    const fake = daemon();
    const controller = createSessionController({
      tokenStore: createMemoryTokenStore(),
      transport: fake.transport,
    });

    expect(await controller.pair('127.0.0.1:8787', '12345')).toBe(false);
    expect(controller.getState().error).toBe(PAIR_CODE_ERROR);
    expect(controller.getState().busy).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });

  test('rejects an empty host with the documented message', async () => {
    const fake = daemon();
    const controller = createSessionController({
      tokenStore: createMemoryTokenStore(),
      transport: fake.transport,
    });

    expect(await controller.pair('   ', '123456')).toBe(false);
    expect(controller.getState().error).toBe(INVALID_HOST_ERROR);
    expect(fake.calls).toHaveLength(0);
  });

  test('normalizes the host, saves the token and loads runs', async () => {
    const fake = daemon();
    const store = createMemoryTokenStore();
    const controller = createSessionController({
      tokenStore: store,
      transport: fake.transport,
    });

    expect(await controller.pair(' 127.0.0.1:8787// ', ' 123456 ')).toBe(true);
    const state = controller.getState();
    expect(state.token).toBe('tok-1');
    expect(state.host).toBe('http://127.0.0.1:8787');
    expect(state.runs).toEqual([RUN]);
    expect(state.error).toBe('');
    expect(state.busy).toBe(false);
    expect(await store.loadToken()).toBe('tok-1');

    expect(fake.calls[0].url).toBe('http://127.0.0.1:8787/api/v1/pair/confirm');
    expect(fake.calls[0].body).toBe(
      '{"code":"123456","label":"iphone","kind":"ios"}',
    );
    expect(fake.calls[1].url).toBe('http://127.0.0.1:8787/api/v1/runs');
    expect(fake.calls[1].headers.Authorization).toBe('Bearer tok-1');
  });

  test('surfaces the server error body verbatim in the single error line', async () => {
    const fake = daemon({
      'POST /api/v1/pair/confirm': {
        status: 400,
        payload: { error: 'bad or expired code' },
      },
    });
    const controller = createSessionController({
      tokenStore: createMemoryTokenStore(),
      transport: fake.transport,
    });

    expect(await controller.pair('127.0.0.1:8787', '000000')).toBe(false);
    expect(controller.getState().error).toBe('bad or expired code');
    expect(controller.getState().token).toBe(null);
  });

  test('falls back to the documented pair error for non-ApiError failures', async () => {
    const controller = createSessionController({
      tokenStore: createMemoryTokenStore(),
      transport: async () => {
        throw new TypeError('Network request failed');
      },
    });

    expect(await controller.pair('127.0.0.1:8787', '123456')).toBe(false);
    expect(controller.getState().error).toBe('Network request failed');
    expect(PAIR_ERROR_FALLBACK).toBe('Pair failed. Check code and host.');
  });
});

describe('refresh (ios/ContentView.swift:96-105)', () => {
  test('reports the generic fetch error and keeps the old runs', async () => {
    const fake = daemon();
    const controller = createSessionController({
      tokenStore: createMemoryTokenStore(),
      transport: fake.transport,
    });
    await controller.pair('127.0.0.1:8787', '123456');

    const failing = createSessionController({
      tokenStore: createMemoryTokenStore('tok-1'),
      transport: fake.transport,
    });
    await failing.hydrate();
    expect(failing.getState().runs).toEqual([RUN]);

    const broken = createSessionController({
      tokenStore: createMemoryTokenStore('tok-1'),
      transport: async () => ({
        status: 500,
        async text() {
          return '';
        },
      }),
    });
    await broken.hydrate();
    expect(broken.getState().error).toBe(FETCH_ERROR);
    expect(broken.getState().runs).toEqual([]);
  });

  test('does nothing without a token', async () => {
    const fake = daemon();
    const controller = createSessionController({
      tokenStore: createMemoryTokenStore(),
      transport: fake.transport,
    });
    await controller.refresh();
    expect(fake.calls).toHaveLength(0);
  });
});

describe('send (ios/ContentView.swift:115-125)', () => {
  test('derives the title from the prompt when the title is blank', async () => {
    const fake = daemon();
    const controller = createSessionController({
      tokenStore: createMemoryTokenStore(),
      transport: fake.transport,
    });
    await controller.pair('127.0.0.1:8787', '123456');

    expect(await controller.send('   ', '  say hi  ')).toBe(true);
    const post = fake.calls.filter(call => call.method === 'POST')[1];
    expect(post.url).toBe('http://127.0.0.1:8787/api/v1/runs');
    expect(post.headers.Authorization).toBe('Bearer tok-1');
    expect(post.body).toBe('{"title":"say hi","prompt":"say hi"}');
  });

  test('uses an explicit title and trims the prompt', async () => {
    const fake = daemon();
    const controller = createSessionController({
      tokenStore: createMemoryTokenStore(),
      transport: fake.transport,
    });
    await controller.pair('127.0.0.1:8787', '123456');

    await controller.send('deploy', '  run the tests ');
    const post = fake.calls.filter(call => call.method === 'POST')[1];
    expect(post.body).toBe('{"title":"deploy","prompt":"run the tests"}');
  });

  test('ignores an empty prompt', async () => {
    const fake = daemon();
    const controller = createSessionController({
      tokenStore: createMemoryTokenStore('tok-1'),
      transport: fake.transport,
    });
    expect(await controller.send('t', '   ')).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });

  test('reports the generic send error', async () => {
    const fake = daemon({
      'POST /api/v1/runs': { status: 500, payload: { error: 'boom' } },
    });
    const controller = createSessionController({
      tokenStore: createMemoryTokenStore(),
      transport: fake.transport,
    });
    await controller.pair('127.0.0.1:8787', '123456');
    expect(await controller.send('t', 'p')).toBe(false);
    expect(controller.getState().error).toBe(SEND_ERROR);
  });
});

describe('signOut / hydrate', () => {
  test('sign-out clears the keychain token and the list', async () => {
    const store = createMemoryTokenStore();
    const controller = createSessionController({
      tokenStore: store,
      transport: daemon().transport,
    });
    await controller.pair('127.0.0.1:8787', '123456');
    expect(await store.loadToken()).toBe('tok-1');

    await controller.signOut();
    expect(await store.loadToken()).toBe(null);
    const state = controller.getState();
    expect(state.token).toBe(null);
    expect(state.runs).toEqual([]);
    expect(state.error).toBe('');
    expect(state.status).toBe('stopped');
  });

  test('sign-out survives a keychain that throws', async () => {
    const controller = createSessionController({
      tokenStore: {
        async saveToken() {},
        async loadToken() {
          return 'tok-1';
        },
        async deleteToken() {
          throw new Error('keychain unavailable');
        },
      },
      transport: daemon().transport,
    });
    await controller.hydrate();
    await controller.signOut();
    expect(controller.getState().token).toBe(null);
  });

  test('hydrate restores the token and loads the list', async () => {
    const fake = daemon();
    const controller = createSessionController({
      tokenStore: createMemoryTokenStore('tok-hydrated'),
      transport: fake.transport,
    });
    await controller.hydrate();

    expect(controller.getState().token).toBe('tok-hydrated');
    expect(controller.getState().runs).toEqual([RUN]);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].headers.Authorization).toBe('Bearer tok-hydrated');
  });

  test('hydrate stays logged out when the keychain is empty', async () => {
    const fake = daemon();
    const controller = createSessionController({
      tokenStore: createMemoryTokenStore(),
      transport: fake.transport,
    });
    await controller.hydrate();
    expect(controller.getState().token).toBe(null);
    expect(fake.calls).toHaveLength(0);
  });

  test('default host is the Swift default', async () => {
    const controller = createSessionController({
      tokenStore: createMemoryTokenStore(),
      transport: daemon().transport,
    });
    expect(controller.getState().host).toBe(DEFAULT_HOST);
    expect(DEFAULT_HOST).toBe('http://192.168.68.56:8787');
  });
});

describe('paired host persistence (relaunch reconnects where you paired)', () => {
  function memoryHostStore(initial: string | null = null) {
    let host = initial;
    return {
      async loadHost() {
        return host;
      },
      async saveHost(next: string) {
        host = next;
      },
      async clearHost() {
        host = null;
      },
      peek() {
        return host;
      },
    };
  }

  test('pair saves the normalized host next to the token', async () => {
    const hostStore = memoryHostStore();
    const controller = createSessionController({
      tokenStore: createMemoryTokenStore(),
      transport: daemon().transport,
      hostStore,
    });

    await controller.pair(' 10.0.0.9:9100 ', '123456');
    expect(hostStore.peek()).toBe('http://10.0.0.9:9100');
  });

  test('hydrate restores the stored host and uses it for the fetch', async () => {
    const fake = daemon();
    const controller = createSessionController({
      tokenStore: createMemoryTokenStore('tok-1'),
      transport: fake.transport,
      hostStore: memoryHostStore('http://10.0.0.9:9100/'),
    });
    await controller.hydrate();

    expect(controller.getState().host).toBe('http://10.0.0.9:9100');
    expect(fake.calls[0].url).toBe('http://10.0.0.9:9100/api/v1/runs');
  });

  test('a pinned host wins over the stored one', async () => {
    const controller = createSessionController({
      tokenStore: createMemoryTokenStore('tok-1'),
      transport: daemon().transport,
      host: '127.0.0.1:8787',
      hostStore: memoryHostStore('http://10.0.0.9:9100'),
    });
    await controller.hydrate();
    expect(controller.getState().host).toBe('http://127.0.0.1:8787');
  });

  test('sign-out clears the stored host and falls back to the default', async () => {
    const hostStore = memoryHostStore('http://10.0.0.9:9100');
    const controller = createSessionController({
      tokenStore: createMemoryTokenStore('tok-1'),
      transport: daemon().transport,
      hostStore,
    });
    await controller.hydrate();
    expect(controller.getState().host).toBe('http://10.0.0.9:9100');

    await controller.signOut();
    expect(hostStore.peek()).toBe(null);
    expect(controller.getState().host).toBe(DEFAULT_HOST);
  });

  test('a throwing host store never blocks pairing or hydrate', async () => {
    const controller = createSessionController({
      tokenStore: createMemoryTokenStore('tok-1'),
      transport: daemon().transport,
      hostStore: {
        async loadHost() {
          throw new Error('storage unavailable');
        },
        async saveHost() {
          throw new Error('storage unavailable');
        },
        async clearHost() {
          throw new Error('storage unavailable');
        },
      },
    });
    await controller.hydrate();
    expect(controller.getState().token).toBe('tok-1');
    expect(controller.getState().host).toBe(DEFAULT_HOST);
  });
});

describe('live updates', () => {
  test('applyEvent folds stream state into the run list', async () => {
    const controller = createSessionController({
      tokenStore: createMemoryTokenStore(),
      transport: daemon().transport,
    });
    await controller.pair('127.0.0.1:8787', '123456');

    controller.applyEvent({
      id: '1',
      type: 'tool.request',
      runId: 'r1',
      tool: 'shell',
    });
    expect(controller.getState().runs[0].state).toBe('waiting_tool');

    controller.applyEvent({
      id: '2',
      type: 'run.done',
      runId: 'r1',
      state: 'done',
    });
    expect(controller.getState().runs[0].state).toBe('done');
  });

  test('setStreamStatus moves the status without redundant renders', async () => {
    const controller = createSessionController({
      tokenStore: createMemoryTokenStore(),
      transport: daemon().transport,
    });
    let changes = 0;
    const unsubscribe = controller.subscribe(() => {
      changes += 1;
    });

    controller.setStreamStatus('live');
    controller.setStreamStatus('live');
    expect(controller.getState().status).toBe('live');
    expect(changes).toBe(1);

    unsubscribe();
    controller.setStreamStatus('reconnecting');
    expect(changes).toBe(1);
  });
});
