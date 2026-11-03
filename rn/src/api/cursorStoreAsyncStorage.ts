// S4 storage: replay cursor persistence. Same key shape the browser client uses
// (web/app.js:18,65-68 `localStorage["zot.since"]`), stored in AsyncStorage.
// Isolated from stream.ts so the stream module stays importable under plain node.
//
// The key is scoped per host. A single global `zot.since` made the cursor
// meaningless after a host switch: event ids are that daemon's sequence
// numbers, so carrying host A's cursor into host B skips every event up to it.
// Host B now starts from its own key (no cursor), which replays from 0.
//
// No migration from the old unprefixed key on purpose: adopting it would
// re-introduce exactly that skip on the first launch after a host switch, and
// the loss is bounded to one replay, not to a wrong list.

import AsyncStorage from '@react-native-async-storage/async-storage';

import { normalizeBaseURL } from './client.ts';
import type { CursorStore } from './stream.ts';

/** Legacy global key, kept exported so the scoping change stays explicit. */
export const STREAM_CURSOR_KEY = 'zot.since';

/** `zot.since.192-168-68-56-8787`: stable, readable, no scheme/port ambiguity. */
export function streamCursorKey(host: string): string {
  const base = normalizeBaseURL(host);
  if (base === '') return STREAM_CURSOR_KEY;
  const slug = base
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return STREAM_CURSOR_KEY + '.' + (slug === '' ? 'default' : slug);
}

export function createAsyncStorageCursorStore(key: string): CursorStore {
  // The key is required on purpose. A default here would be one cursor shared
  // by every daemon again (see the header): a future caller omitting the
  // argument is a type error instead of a silent skip on the next host.
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
