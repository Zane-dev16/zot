// S4 storage: replay cursor persistence. Same key the browser client uses
// (web/app.js:18,65-68 `localStorage["zot.since"]`), stored in AsyncStorage.
// Isolated from stream.ts so the stream module stays importable under plain node.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CursorStore } from './stream.ts';

export const STREAM_CURSOR_KEY = 'zot.since';

export function createAsyncStorageCursorStore(
  key: string = STREAM_CURSOR_KEY,
): CursorStore {
  return {
    async load() {
      const value = await AsyncStorage.getItem(key);
      return typeof value === 'string' && value !== '' ? value : null;
    },
    async save(id) {
      await AsyncStorage.setItem(key, id);
    },
    async clear() {
      await AsyncStorage.removeItem(key);
    },
  };
}
