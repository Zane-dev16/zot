// S2: Keychain token storage, same identifiers as ios/Keychain.swift.
// Kept out of client.ts so the API module stays importable under plain node.

import * as Keychain from 'react-native-keychain';
import type { TokenStore } from './client.ts';

export const TOKEN_SERVICE = 'zot-token';
export const TOKEN_ACCOUNT = 'device-token';

export function createKeychainTokenStore(): TokenStore {
  return {
    async saveToken(token) {
      const result = await Keychain.setGenericPassword(TOKEN_ACCOUNT, token, {
        service: TOKEN_SERVICE,
      });
      if (result === false) throw new Error('Failed to save token to keychain');
    },
    async loadToken() {
      const credentials = await Keychain.getGenericPassword({
        service: TOKEN_SERVICE,
      });
      if (credentials === false) return null;
      if (typeof credentials.password !== 'string') return null;
      if (credentials.password === '') return null;
      return credentials.password;
    },
    async deleteToken() {
      await Keychain.resetGenericPassword({ service: TOKEN_SERVICE });
    },
  };
}
