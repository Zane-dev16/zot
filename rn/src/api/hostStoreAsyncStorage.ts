// S2 companion: the paired host, persisted next to the keychain token.
// The token stays in the keychain only (tokenStoreKeychain.ts); the host is not
// a secret, so AsyncStorage is enough and survives relaunch. Without this the
// app reconnected to the hard-coded default after every cold start even when
// the user had paired somewhere else.
//
// Kept out of sessionController.ts so the controller stays importable under
// plain node.

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { HostStore } from './client.ts';

/** Same idea as web's localStorage keys: one namespaced key per stored value. */
export const HOST_KEY = 'zot.host';

export function createAsyncStorageHostStore(key: string = HOST_KEY): HostStore {
  return {
    async loadHost() {
      const value = await AsyncStorage.getItem(key);
      return typeof value === 'string' && value !== '' ? value : null;
    },
    async saveHost(host) {
      await AsyncStorage.setItem(key, host);
    },
    async clearHost() {
      await AsyncStorage.removeItem(key);
    },
  };
}
