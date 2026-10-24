jest.mock("react-native-keychain", () => ({
	setGenericPassword: jest.fn(async () => ({
		service: "zot-token",
		storage: "test",
	})),
	getGenericPassword: jest.fn(async () => ({
		username: "device-token",
		password: "tok-keychain",
		service: "zot-token",
	})),
	resetGenericPassword: jest.fn(async () => true),
}));

import * as Keychain from "react-native-keychain";
import {
	TOKEN_ACCOUNT,
	TOKEN_SERVICE,
	createKeychainTokenStore,
} from "../src/api/tokenStoreKeychain";

test("keychain store uses the Swift identifiers and round-trips the token", async () => {
	expect(TOKEN_SERVICE).toBe("zot-token");
	expect(TOKEN_ACCOUNT).toBe("device-token");

	const store = createKeychainTokenStore();
	await store.saveToken("tok-keychain");
	expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
		"device-token",
		"tok-keychain",
		{ service: "zot-token" },
	);

	expect(await store.loadToken()).toBe("tok-keychain");
	expect(Keychain.getGenericPassword).toHaveBeenCalledWith({
		service: "zot-token",
	});

	await store.deleteToken();
	expect(Keychain.resetGenericPassword).toHaveBeenCalledWith({
		service: "zot-token",
	});
});

test("keychain store reports a missing token as null", async () => {
	(Keychain.getGenericPassword as unknown as jest.Mock).mockResolvedValueOnce(
		false,
	);
	const store = createKeychainTokenStore();
	expect(await store.loadToken()).toBe(null);
});
