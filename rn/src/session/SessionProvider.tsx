// React shell around the pure session controller. Owns the keychain-backed
// token store, the AsyncStorage replay cursor, the live stream and the polling
// fallback (Swift parity: ios/ContentView.swift only polls on appear/refresh,
// so the list stays correct without a stream).

import React, {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useSyncExternalStore,
} from "react";

import type { TokenStore, Transport } from "../api/client.ts";
import { ApiError, listRuns } from "../api/client.ts";
import { createAsyncStorageCursorStore } from "../api/cursorStoreAsyncStorage.ts";
import type {
	CursorStore,
	StreamHandle,
	StreamStatus,
} from "../api/stream.ts";
import { connectStream } from "../api/stream.ts";
import { createKeychainTokenStore } from "../api/tokenStoreKeychain.ts";
import type { SessionController, SessionState } from "./sessionController.ts";
import { createSessionController } from "./sessionController.ts";

/** Polling cadence used while the stream is not live. */
export const POLL_INTERVAL_MS = 8000;

export type ConnectStreamFn = typeof connectStream;

export type SessionDeps = {
	tokenStore?: TokenStore;
	transport?: Transport;
	host?: string;
	cursorStore?: CursorStore;
	/** Test seam; defaults to the real stream client. */
	connectStreamFn?: ConnectStreamFn;
	pollMs?: number;
};

export type SessionBinding = {
	session: SessionController;
	state: SessionState;
};

const SessionContext = createContext<SessionController | null>(null);

export function useSession(): SessionController {
	const session = useContext(SessionContext);
	if (session === null) {
		throw new Error("useSession must be used inside SessionProvider");
	}
	return session;
}

// useSyncExternalStore needs stable subscribe/getSnapshot identities.
export function useSessionState(): SessionBinding {
	return useSessionStateFor(useSession());
}

function useSessionStateFor(controller: SessionController): SessionBinding {
	const subscribe = useCallback(
		(listener: () => void) => controller.subscribe(listener),
		[controller],
	);
	const getSnapshot = useCallback(() => controller.getState(), [controller]);
	const state = useSyncExternalStore(subscribe, getSnapshot);
	return useMemo(() => ({ session: controller, state }), [controller, state]);
}

export type SessionProviderProps = {
	deps?: SessionDeps;
	children: React.ReactNode;
};

export function SessionProvider(
	props: SessionProviderProps,
): React.ReactElement {
	const deps = props.deps ?? {};
	const tokenStore = useMemo(
		() => deps.tokenStore ?? createKeychainTokenStore(),
		[deps.tokenStore],
	);
	const cursorStore = useMemo(
		() => deps.cursorStore ?? createAsyncStorageCursorStore(),
		[deps.cursorStore],
	);
	const transport = deps.transport;
	const host = deps.host;
	const pollMs = deps.pollMs ?? POLL_INTERVAL_MS;
	const connectFn = deps.connectStreamFn ?? connectStream;

	const controllerRef = useRef<SessionController | null>(null);
	if (controllerRef.current === null) {
		controllerRef.current = createSessionController({
			tokenStore,
			transport,
			host,
		});
	}
	const controller = controllerRef.current;

	const binding = useSessionStateFor(controller);
	const token = binding.state.token;
	const status = binding.state.status;

	useEffect(() => {
		controller.hydrate().catch(() => {});
	}, [controller]);

	useEffect(() => {
		if (token === null) return;
		const probeUnauthorized = async (): Promise<boolean> => {
			try {
				await listRuns(controller.getState().host, token, { transport });
				return false;
			} catch (err) {
				return err instanceof ApiError && err.status === 401;
			}
		};
		const handle: StreamHandle = connectFn(
			controller.getState().host,
			token,
			{
				cursorStore,
				onEvent: controller.applyEvent,
				onStatus: (next: StreamStatus) => controller.setStreamStatus(next),
				probeUnauthorized,
			},
		);
		handle.start().catch(() => {});
		return () => {
			handle.stop();
		};
	}, [connectFn, controller, cursorStore, token, transport]);

	// Fallback polling: only while the stream is not live.
	useEffect(() => {
		if (token === null || status === "live" || pollMs <= 0) return;
		const timer = setInterval(() => {
			controller.refresh().catch(() => {});
		}, pollMs);
		return () => {
			clearInterval(timer);
		};
	}, [controller, pollMs, status, token]);

	return (
		<SessionContext.Provider value={controller}>
			{props.children}
		</SessionContext.Provider>
	);
}
