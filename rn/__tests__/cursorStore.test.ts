/**
 * S4 cursor scoping: one replay cursor per daemon host. Event ids are that
 * daemon's sequence numbers, so a single global key carried a stale cursor into
 * the next host and skipped its events.
 *
 * @format
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  createAsyncStorageCursorStore,
  STREAM_CURSOR_KEY,
  streamCursorKey,
} from '../src/api/cursorStoreAsyncStorage';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('streamCursorKey', () => {
  test('scopes the browser key by host without scheme or separators', () => {
    expect(streamCursorKey('192.168.68.56:8787')).toBe(
      'zot.since.192-168-68-56-8787',
    );
    expect(streamCursorKey('http://192.168.68.56:8787')).toBe(
      'zot.since.192-168-68-56-8787',
    );
    expect(streamCursorKey('http://192.168.68.56:8787/')).toBe(
      'zot.since.192-168-68-56-8787',
    );
  });

  test('different hosts get different keys', () => {
    const a = streamCursorKey('http://192.168.68.56:8787');
    const b = streamCursorKey('http://192.168.68.67:8787');
    expect(a).not.toBe(b);
  });

  test('an empty host falls back to the legacy key', () => {
    expect(streamCursorKey('   ')).toBe(STREAM_CURSOR_KEY);
  });
});

describe('createAsyncStorageCursorStore', () => {
  test('the key argument is required', () => {
    // A defaulted key would let a future caller silently reuse one cursor
    // across daemons, which is the bug this store exists to prevent. TypeScript
    // rejects a call without it; the arity check keeps the runtime honest too.
    expect(createAsyncStorageCursorStore.length).toBe(1);
  });

  test('each host keeps its own cursor', async () => {
    const first = createAsyncStorageCursorStore(
      streamCursorKey('http://192.168.68.56:8787'),
    );
    const second = createAsyncStorageCursorStore(
      streamCursorKey('http://192.168.68.67:8787'),
    );

    expect(await first.load()).toBe(null);
    expect(await second.load()).toBe(null);

    await first.save('42');
    expect(await first.load()).toBe('42');
    // The other host must not inherit it: that would skip its events.
    expect(await second.load()).toBe(null);
    expect(await AsyncStorage.getItem(STREAM_CURSOR_KEY)).toBe(null);

    await second.save('7');
    expect(await first.load()).toBe('42');
    expect(await second.load()).toBe('7');

    await first.clear();
    expect(await first.load()).toBe(null);
    expect(await second.load()).toBe('7');
  });

  test('an empty stored value reads as no cursor', async () => {
    const store = createAsyncStorageCursorStore('zot.since.test');
    await AsyncStorage.setItem('zot.since.test', '');
    expect(await store.load()).toBe(null);
  });
});
