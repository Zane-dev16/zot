// Session state machine: token, host, runs, error line. Ports the behavior of
// ios/ApiClient.swift + ios/ContentView.swift:68-127 without React imports so
// it can be tested headless. SessionProvider.tsx is the React shell around it.

import type {
  AgentRun,
  HostStore,
  TokenStore,
  Transport,
} from '../api/client.ts';
import {
  ApiError,
  createRun,
  listRuns,
  normalizeBaseURL,
  pairConfirm,
} from '../api/client.ts';
import type { StreamEvent, StreamStatus } from '../api/stream.ts';
import { applyRunEvent } from '../api/stream.ts';
import {
  INVALID_HOST_ERROR,
  PAIR_CODE_ERROR,
  deriveRunTitle,
  isValidPairCode,
  normalizePairCode,
} from './validation.ts';

export const DEFAULT_HOST = 'http://192.168.68.56:8787';
export const PAIR_ERROR_FALLBACK = 'Pair failed. Check code and host.';
export const FETCH_ERROR = 'Fetch failed. Check LAN and token.';
export const SEND_ERROR = 'Send failed.';
export const DEFAULT_PAIR_LABEL = 'iphone';

export type SessionState = {
  host: string;
  token: string | null;
  runs: AgentRun[];
  error: string;
  busy: boolean;
  status: StreamStatus;
  /** True once the keychain read at launch finished (token or not). */
  hydrated: boolean;
};

export type SessionControllerOptions = {
  tokenStore: TokenStore;
  transport?: Transport;
  host?: string;
  label?: string;
  /**
   * Paired host persistence. Optional: without it the controller runs on the
   * injected/default host only, which is what the pure-node tests want.
   */
  hostStore?: HostStore;
};

export type SessionController = {
  getState(): SessionState;
  subscribe(listener: () => void): () => void;
  hydrate(): Promise<void>;
  pair(host: string, code: string): Promise<boolean>;
  refresh(): Promise<void>;
  send(title: string, prompt: string): Promise<boolean>;
  signOut(): Promise<void>;
  applyEvent(event: StreamEvent): void;
  setStreamStatus(status: StreamStatus): void;
  /** Replace the single error line; '' clears it. */
  setError(error: string): void;
};

function messageOf(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.message !== '') return err.message;
  if (err instanceof Error && err.message !== '') return err.message;
  return fallback;
}

export function createSessionController(
  options: SessionControllerOptions,
): SessionController {
  const tokenStore = options.tokenStore;
  const transport = options.transport;
  const hostStore = options.hostStore ?? null;
  // An injected host is a deliberate override (tests, baked pair), so the
  // stored host never wins over it.
  const pinnedHost = options.host !== undefined;
  let state: SessionState = {
    host: normalizeBaseURL(options.host ?? DEFAULT_HOST),
    token: null,
    runs: [],
    error: '',
    busy: false,
    status: 'stopped',
    hydrated: false,
  };
  const listeners = new Set<() => void>();

  function emit(): void {
    for (const listener of listeners) listener();
  }

  function setState(patch: Partial<SessionState>): void {
    state = { ...state, ...patch };
    emit();
  }

  function currentToken(): string | null {
    return state.token;
  }

  async function refresh(): Promise<void> {
    const token = currentToken();
    if (token === null) return;
    try {
      const runs = await listRuns(state.host, token, { transport });
      setState({ runs });
    } catch {
      // Swift parity (ContentView.swift:102-104): one generic error line.
      setState({ error: FETCH_ERROR });
    }
  }

  async function pair(host: string, code: string): Promise<boolean> {
    const normalizedHost = normalizeBaseURL(host);
    const trimmed = normalizePairCode(code);
    setState({ error: '', busy: true });
    if (!isValidPairCode(trimmed)) {
      setState({ busy: false, error: PAIR_CODE_ERROR });
      return false;
    }
    if (normalizedHost === '') {
      setState({ busy: false, error: INVALID_HOST_ERROR });
      return false;
    }
    try {
      const token = await pairConfirm(normalizedHost, trimmed, {
        transport,
        label: options.label ?? DEFAULT_PAIR_LABEL,
      });
      await tokenStore.saveToken(token);
      setState({ token, host: normalizedHost, error: '' });
      // Pairing is the moment the host becomes the user's choice: remember it
      // so relaunch reconnects here instead of the hard-coded default. A failed
      // write must not fail pairing (the token is already saved).
      if (hostStore !== null) {
        try {
          await hostStore.saveHost(normalizedHost);
        } catch {
          // storage unavailable; the session still works for this launch
        }
      }
      await refresh();
      return true;
    } catch (err) {
      setState({ error: messageOf(err, PAIR_ERROR_FALLBACK) });
      return false;
    } finally {
      setState({ busy: false });
    }
  }

  async function send(title: string, prompt: string): Promise<boolean> {
    const text = prompt.trim();
    if (text === '' || currentToken() === null) return false;
    const runTitle = title.trim() === '' ? deriveRunTitle(text) : title.trim();
    setState({ error: '', busy: true });
    try {
      await createRun(
        state.host,
        currentToken() as string,
        { title: runTitle, prompt: text },
        { transport },
      );
      await refresh();
      return true;
    } catch {
      setState({ error: SEND_ERROR });
      return false;
    } finally {
      setState({ busy: false });
    }
  }

  async function signOut(): Promise<void> {
    try {
      await tokenStore.deleteToken();
    } catch {
      // Nothing to clear is the same end state as clearing it.
    }
    if (hostStore !== null) {
      try {
        await hostStore.clearHost();
      } catch {
        // same end state as cleared
      }
    }
    setState({
      token: null,
      host: normalizeBaseURL(DEFAULT_HOST),
      runs: [],
      error: '',
      busy: false,
      status: 'stopped',
    });
  }

  async function hydrate(): Promise<void> {
    if (state.token !== null) return;
    if (hostStore !== null && !pinnedHost) {
      let stored: string | null = null;
      try {
        stored = await hostStore.loadHost();
      } catch {
        stored = null;
      }
      const normalized = stored === null ? '' : normalizeBaseURL(stored);
      if (normalized !== '' && normalized !== state.host) {
        setState({ host: normalized });
      }
    }
    let token: string | null = null;
    try {
      token = await tokenStore.loadToken();
    } catch {
      token = null;
    }
    if (token === null || token === '') {
      setState({ hydrated: true });
      return;
    }
    setState({ token, hydrated: true });
    await refresh();
  }

  function applyEvent(event: StreamEvent): void {
    const runs = applyRunEvent(state.runs, event);
    if (runs !== state.runs) setState({ runs });
  }

  function setStreamStatus(status: StreamStatus): void {
    if (state.status === status) return;
    setState({ status });
  }

  function setError(error: string): void {
    if (state.error === error) return;
    setState({ error });
  }

  return {
    getState(): SessionState {
      return state;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    hydrate,
    pair,
    refresh,
    send,
    signOut,
    applyEvent,
    setStreamStatus,
    setError,
  };
}
