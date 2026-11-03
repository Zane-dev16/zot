/**
 * S5 push tokens: normalize/validate the APNs hex, upload it with the bearer
 * header, and re-upload on foreground and native token events (ios/ContentView
 * .swift:61-66,99-101 + ios/ApiClient.swift:95-101). Native push is injected.
 *
 * @format
 */

import type { Transport } from '../src/api/client';
import {
  createPushTokenSync,
  getNativePushTokenModule,
  normalizePushToken,
  registerPushToken,
} from '../src/api/pushTokens';
import type {
  AppStateLike,
  PushTokenNative,
  PushTokenTarget,
} from '../src/api/pushTokens';
import { fakeRouterTransport, pathOf, waitFor } from '../test-support/fakes';
import type { FakeResponse } from '../test-support/fakes';

const TOKEN = 'a'.repeat(64);
const TOKEN_UPPER = 'A'.repeat(64);
const AUTH = 'bearer-1';
const HOST = '192.168.68.56:8787';
const TARGET: PushTokenTarget = { host: HOST, authToken: AUTH };

function accepted(status = 201) {
  return fakeRouterTransport(call => {
    if (call.method === 'POST' && pathOf(call.url) === '/api/v1/push/tokens') {
      return { status, payload: { token: { token: TOKEN } } };
    }
    return { status: 404, payload: { error: 'not found' } };
  });
}

function statusResponse(status: number, payload: unknown): Transport {
  return fakeRouterTransport(() => ({ status, payload } as FakeResponse))
    .transport;
}

type FakeNative = PushTokenNative & {
  emit(token: string): void;
  setStashed(token: string | null): void;
  listenerCount(): number;
};

function fakeNative(stashed: string | null = null): FakeNative {
  let current = stashed;
  const listeners = new Set<(token: string) => void>();
  return {
    requestPushRegistration: jest.fn(async () => true),
    getStashedPushToken: jest.fn(async () => current),
    addPushTokenListener: jest.fn((listener: (token: string) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
    emit(token: string) {
      current = token;
      for (const listener of listeners) listener(token);
    },
    setStashed(token: string | null) {
      current = token;
    },
    listenerCount(): number {
      return listeners.size;
    },
  };
}

type FakeAppState = AppStateLike & { emit(state: string): void };

function fakeAppState(): FakeAppState {
  const handlers = new Set<(state: string) => void>();
  return {
    currentState: 'active',
    addEventListener: jest.fn(
      (_type: 'change', handler: (state: string) => void) => {
        handlers.add(handler);
        return {
          remove: () => {
            handlers.delete(handler);
          },
        };
      },
    ),
    emit(state: string) {
      for (const handler of handlers) handler(state);
    },
  };
}

describe('normalizePushToken (src/push.js:178-186 shape)', () => {
  test('trims and lowercases a 64-hex device token', () => {
    expect(normalizePushToken('  ' + TOKEN_UPPER + '  ')).toBe(TOKEN);
    expect(normalizePushToken(TOKEN)).toBe(TOKEN);
  });

  test('rejects 63 and 65 hex characters', () => {
    expect(normalizePushToken('a'.repeat(63))).toBe(null);
    expect(normalizePushToken('a'.repeat(65))).toBe(null);
  });

  test('rejects null, undefined and non-strings silently', () => {
    expect(normalizePushToken(null)).toBe(null);
    expect(normalizePushToken(undefined)).toBe(null);
    expect(normalizePushToken(42)).toBe(null);
    expect(normalizePushToken({ token: TOKEN })).toBe(null);
    expect(normalizePushToken('z'.repeat(64))).toBe(null);
  });
});

describe('registerPushToken (ios/ApiClient.swift:95-101)', () => {
  test('POSTs the normalized token with the bearer header and accepts 201', async () => {
    const fake = accepted(201);
    const result = await registerPushToken(HOST, TOKEN_UPPER, {
      transport: fake.transport,
      authToken: AUTH,
    });

    expect(result).toEqual({ ok: true, status: 201 });
    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0];
    expect(call.url).toBe('http://192.168.68.56:8787/api/v1/push/tokens');
    expect(call.method).toBe('POST');
    expect(call.headers.Authorization).toBe('Bearer ' + AUTH);
    expect(call.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(String(call.body))).toEqual({
      token: TOKEN,
      platform: 'ios',
    });
  });

  test('accepts 200 as well as 201', async () => {
    const fake = accepted(200);
    await expect(
      registerPushToken(HOST, TOKEN, {
        transport: fake.transport,
        authToken: AUTH,
      }),
    ).resolves.toEqual({ ok: true, status: 200 });
  });

  test('surfaces the daemon {error} body instead of throwing', async () => {
    const result = await registerPushToken(HOST, TOKEN, {
      transport: statusResponse(400, { error: 'invalid token' }),
      authToken: AUTH,
    });
    expect(result).toEqual({ ok: false, status: 400, error: 'invalid token' });
  });

  test('a 401 body falls back to a status message', async () => {
    const result = await registerPushToken(HOST, TOKEN, {
      transport: statusResponse(401, null),
      authToken: AUTH,
    });
    expect(result).toEqual({
      ok: false,
      status: 401,
      error: 'Push token upload failed (status 401).',
    });
  });

  test('never calls the transport without a device token', async () => {
    const fake = accepted();
    for (const token of [null, undefined, '']) {
      await expect(
        registerPushToken(HOST, token, {
          transport: fake.transport,
          authToken: AUTH,
        }),
      ).resolves.toEqual({ ok: false, skipped: 'no-token' });
    }
    expect(fake.calls).toHaveLength(0);
  });

  test('skips a non-64-hex token before any network call', async () => {
    const fake = accepted();
    await expect(
      registerPushToken(HOST, 'a'.repeat(63), {
        transport: fake.transport,
        authToken: AUTH,
      }),
    ).resolves.toEqual({ ok: false, skipped: 'invalid-token' });
    expect(fake.calls).toHaveLength(0);
  });

  test('skips without a paired bearer token', async () => {
    const fake = accepted();
    await expect(
      registerPushToken(HOST, TOKEN, { transport: fake.transport }),
    ).resolves.toEqual({ ok: false, skipped: 'unpaired' });
    expect(fake.calls).toHaveLength(0);
  });

  test('a failing transport becomes an error result, not an exception', async () => {
    const transport: Transport = async () => {
      throw new Error('network down');
    };
    await expect(
      registerPushToken(HOST, TOKEN, { transport, authToken: AUTH }),
    ).resolves.toEqual({ ok: false, error: 'network down' });
  });
});

describe('createPushTokenSync (ContentView load/pushUp + .zotPushToken)', () => {
  test('uploads the stashed hex, lowercased', async () => {
    const fake = accepted();
    const sync = createPushTokenSync({
      transport: fake.transport,
      native: fakeNative(TOKEN_UPPER),
      appState: null,
    });

    await expect(sync.sync(TARGET)).resolves.toEqual({ ok: true, status: 201 });
    expect(fake.calls).toHaveLength(1);
    expect(JSON.parse(String(fake.calls[0].body)).token).toBe(TOKEN);
  });

  test('does not upload when no token was ever stashed', async () => {
    const fake = accepted();
    const sync = createPushTokenSync({
      transport: fake.transport,
      native: fakeNative(null),
      appState: null,
    });

    await expect(sync.sync(TARGET)).resolves.toEqual({
      ok: false,
      skipped: 'no-token',
    });
    expect(fake.calls).toHaveLength(0);
  });

  test('does not upload while unpaired', async () => {
    const fake = accepted();
    const sync = createPushTokenSync({
      transport: fake.transport,
      native: fakeNative(TOKEN),
      appState: null,
    });

    await expect(sync.sync({ host: HOST, authToken: null })).resolves.toEqual({
      ok: false,
      skipped: 'unpaired',
    });
    expect(fake.calls).toHaveLength(0);
  });

  test('re-uploads on every foreground, not on background', async () => {
    const fake = accepted();
    const appState = fakeAppState();
    const sync = createPushTokenSync({
      transport: fake.transport,
      native: fakeNative(TOKEN),
      appState,
    });
    const stop = sync.start(() => TARGET);

    appState.emit('background');
    expect(fake.calls).toHaveLength(0);
    appState.emit('active');
    await waitFor(() => fake.calls.length === 1);
    appState.emit('active');
    await waitFor(() => fake.calls.length === 2);

    stop();
    appState.emit('active');
    await Promise.resolve();
    expect(fake.calls).toHaveLength(2);
  });

  test('uploads as soon as the native module delivers a token', async () => {
    const fake = accepted();
    const native = fakeNative(null);
    const sync = createPushTokenSync({
      transport: fake.transport,
      native,
      appState: null,
    });
    const stop = sync.start(() => TARGET);

    native.emit(TOKEN_UPPER);
    await waitFor(() => fake.calls.length === 1);
    expect(JSON.parse(String(fake.calls[0].body)).token).toBe(TOKEN);

    stop();
    expect(native.listenerCount()).toBe(0);
  });

  test('requests authorization through the native module', async () => {
    const native = fakeNative(TOKEN);
    const sync = createPushTokenSync({
      transport: accepted().transport,
      native,
      appState: null,
    });

    await expect(sync.request()).resolves.toBe(true);
    expect(native.requestPushRegistration).toHaveBeenCalledTimes(1);
  });

  test('is inert when the native module is absent (jest default)', async () => {
    const fake = accepted();
    const sync = createPushTokenSync({
      transport: fake.transport,
      native: null,
      appState: fakeAppState(),
    });

    await expect(sync.request()).resolves.toBe(false);
    await expect(sync.sync(TARGET)).resolves.toEqual({
      ok: false,
      skipped: 'no-token',
    });
    const stop = sync.start(() => TARGET);
    stop();
    expect(fake.calls).toHaveLength(0);
  });

  test('the real module resolves to null off-device (empty NativeModules)', () => {
    expect(getNativePushTokenModule()).toBe(null);
  });

  test('a malformed native module is inert, not a startup crash', async () => {
    // A present-but-broken module: the promise methods exist, the RCTEventEmitter
    // surface NativeEventEmitter needs does not. Before the guard this threw
    // inside start() during a React effect and took startup down.
    const broken = {
      requestPushRegistration: async () => true,
      getStashedPushToken: async () => TOKEN,
    } as unknown as PushTokenNative;
    const fake = accepted();
    const sync = createPushTokenSync({
      transport: fake.transport,
      native: broken,
      appState: fakeAppState(),
    });

    const stop = sync.start(() => TARGET);
    expect(typeof stop).toBe('function');
    stop();
  });

  test('a listener that throws at subscribe time leaves push inert', async () => {
    const native: PushTokenNative = {
      requestPushRegistration: async () => true,
      getStashedPushToken: async () => TOKEN,
      addPushTokenListener() {
        throw new Error('NativeEventEmitter: module is not an RCTEventEmitter');
      },
    };
    const fake = accepted();
    const sync = createPushTokenSync({
      transport: fake.transport,
      native,
      appState: fakeAppState(),
    });

    // No throw out of the subscription setup, and the foreground hook still
    // uploads (start() attempted each hook independently).
    let stop: (() => void) | null = null;
    expect(() => {
      stop = sync.start(() => TARGET);
    }).not.toThrow();
    expect(stop).not.toBeNull();
    (stop as unknown as () => void)();
    await expect(sync.sync(TARGET)).resolves.toEqual({ ok: true, status: 201 });
  });

  test('a disposer that throws does not break teardown', () => {
    const native: PushTokenNative = {
      requestPushRegistration: async () => true,
      getStashedPushToken: async () => TOKEN,
      addPushTokenListener() {
        return () => {
          throw new Error('already disposed');
        };
      },
    };
    const sync = createPushTokenSync({
      transport: accepted().transport,
      native,
      appState: null,
    });
    const stop = sync.start(() => TARGET);
    expect(() => stop()).not.toThrow();
  });
});
