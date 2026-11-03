// S4: events stream client. Ports the browser contract in web/app.js:237-330
// (ws URL with token + since, reconnect with backoff, persisted replay cursor)
// to the daemon stream in src/stream.js:140-212 (heartbeat every 15s).
//
// Pure TS on purpose: socket, cursor store and timers are injectable, so this
// module runs under plain node (live tracer) and jest. React Native storage
// lives in cursorStoreAsyncStorage.ts so nothing here imports an RN module.

import type { AgentRun } from './client.ts';
import { ApiError, normalizeBaseURL } from './client.ts';

export const STREAM_PATH = '/api/v1/stream';
/** Server pings daemon.heartbeat every 15s (src/stream.js:10,205-212). */
export const HEARTBEAT_MS = 15000;
export const RECONNECT_MIN_MS = 1000;
export const RECONNECT_MAX_MS = 10000;
/** How many event ids to remember for replay de-duplication. */
export const SEEN_LIMIT = 500;

export type StreamEvent = {
  type: string;
  id?: string;
  at?: number;
  runId?: string;
  state?: string;
  title?: string;
  tool?: string;
  token?: string;
  [key: string]: unknown;
};

export type SocketLike = {
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  close(code?: number, reason?: string): void;
};

export type SocketFactory = (url: string) => SocketLike;

export type CursorStore = {
  load(): Promise<string | null>;
  save(id: string): Promise<void>;
  clear(): Promise<void>;
};

export type StreamStatus =
  | 'stopped'
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'auth';

export type TimerHandle = ReturnType<typeof setTimeout>;
export type SetTimeoutFn = (fn: () => void, ms: number) => TimerHandle;
export type ClearTimeoutFn = (handle: TimerHandle | null) => void;

export type StreamOptions = {
  socketFactory?: SocketFactory;
  cursorStore?: CursorStore;
  onEvent?: (event: StreamEvent) => void;
  onStatus?: (status: StreamStatus) => void;
  /** Server heartbeat cadence. Two missed beats is a stale socket. */
  heartbeatMs?: number;
  /** Override the watchdog window; 0 disables it. Defaults to 2 * heartbeatMs. */
  staleAfterMs?: number;
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
  /** Web parity: a 401 probe stops retrying and reports "auth". */
  probeUnauthorized?: () => Promise<boolean>;
  setTimeoutFn?: SetTimeoutFn;
  clearTimeoutFn?: ClearTimeoutFn;
};

export type StreamHandle = {
  start(): Promise<void>;
  stop(): void;
  status(): StreamStatus;
  since(): string | null;
};

type RunPatch = { title?: string; state?: string };

// pi-lens-ignore: Semgrep:javascript.lang.security.detect-insecure-websocket.detect-insecure-websocket
// ws://host/api/v1/stream?token=...&since=... (web/app.js:237-245).
export function streamURL(
  host: string,
  token: string,
  since?: string | null,
): string {
  const base = normalizeBaseURL(host);
  if (base === '') {
    throw new ApiError('Invalid host. Add http:// and check host.', 0);
  }
  const wsBase = base
    .replace(/^ws(s?):\/\//i, 'ws$1://')
    .replace(/^http(s?):\/\//i, 'ws$1://');
  let url = wsBase + STREAM_PATH + '?token=' + encodeURIComponent(token);
  if (since !== undefined && since !== null && since !== '') {
    url += '&since=' + encodeURIComponent(since);
  }
  return url;
}

// One bad frame must not kill the stream (web/app.js:305-310).
export function parseStreamEvent(raw: unknown): StreamEvent | null {
  if (typeof raw !== 'string' || raw === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') return null;
  const type = (parsed as { type?: unknown }).type;
  if (typeof type !== 'string' || type === '') return null;
  return parsed as StreamEvent;
}

function eventPatch(event: StreamEvent): RunPatch | null {
  const state =
    typeof event.state === 'string' && event.state !== ''
      ? event.state
      : undefined;
  const patch: RunPatch = {};
  if (event.type === 'run.created') {
    if (typeof event.title === 'string' && event.title !== '') {
      patch.title = event.title;
    }
    if (state !== undefined) patch.state = state;
  } else if (event.type === 'run.state') {
    if (state !== undefined) patch.state = state;
  } else if (event.type === 'run.done') {
    patch.state = state ?? 'done';
  } else if (event.type === 'tool.request') {
    patch.state = 'waiting_tool';
  } else {
    // daemon.heartbeat, run.token, tool.result: no list-visible change.
    return null;
  }
  // run.created announces a run even with no title/state fields, and
  // applyRunEvent turns that into a row (web/app.js:203-210). The other types
  // only carry patches, so an empty patch means nothing to show.
  if (
    patch.title === undefined &&
    patch.state === undefined &&
    event.type !== 'run.created'
  ) {
    return null;
  }
  return patch;
}

// Folds a stream event into the run list (web/app.js:190-235). Returns the same
// array when nothing list-visible changed, so React can skip a re-render.
//
// A run.created for an id the list has never seen APPENDS a row, the way
// web/app.js:203-210 creates a run block on demand. Scheduler-fired and
// browser-created runs publish exactly that event (src/runner.js:244-258) and,
// because the phone stops polling while the socket is live, folding only into
// known ids would hide them until the next manual refresh. Every other event
// for an unknown id is still dropped: those carry no title, and the daemon's
// list refresh is the authority for their details.
export function applyRunEvent(
  runs: AgentRun[],
  event: StreamEvent,
): AgentRun[] {
  const patch = eventPatch(event);
  if (patch === null) return runs;
  const runId = typeof event.runId === 'string' ? event.runId : null;
  if (runId === null) return runs;
  const index = runs.findIndex(run => run.id === runId);
  if (index === -1) {
    if (event.type !== 'run.created') return runs;
    // Replays repeat the same id: one row per id, and a second run.created for
    // a row this fold created just lands in the patch branch below.
    const created: AgentRun = {
      id: runId,
      title: patch.title ?? runId,
      prompt: typeof event.prompt === 'string' ? event.prompt : '',
      state: patch.state ?? '',
    };
    return [...runs, created];
  }
  const current = runs[index];
  const title = patch.title ?? current.title;
  const state = patch.state ?? current.state;
  if (title === current.title && state === current.state) return runs;
  const next = runs.slice();
  next[index] = { ...current, title, state };
  return next;
}

export function createMemoryCursorStore(
  initial: string | null = null,
): CursorStore {
  let cursor = initial;
  return {
    async load() {
      return cursor;
    },
    async save(id) {
      cursor = id;
    },
    async clear() {
      cursor = null;
    },
  };
}

export function defaultSocketFactory(url: string): SocketLike {
  // SAFETY: the RN runtime and node both expose a WHATWG WebSocket global whose
  // instances have the SocketLike handlers; the global itself is not in the lib types.
  const Ctor = (
    globalThis as unknown as { WebSocket?: new (url: string) => SocketLike }
  ).WebSocket;
  if (!Ctor) throw new ApiError('WebSocket is not available', 0);
  return new Ctor(url);
}

export function connectStream(
  host: string,
  token: string,
  options: StreamOptions = {},
): StreamHandle {
  const socketFactory = options.socketFactory ?? defaultSocketFactory;
  const cursorStore = options.cursorStore ?? createMemoryCursorStore();
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
  const staleAfterMs =
    options.staleAfterMs ?? (heartbeatMs > 0 ? heartbeatMs * 2 : 0);
  const reconnectMinMs = options.reconnectMinMs ?? RECONNECT_MIN_MS;
  const reconnectMaxMs = options.reconnectMaxMs ?? RECONNECT_MAX_MS;
  const setT: SetTimeoutFn =
    options.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT: ClearTimeoutFn =
    options.clearTimeoutFn ??
    (handle => {
      if (handle !== null) clearTimeout(handle);
    });

  let cursor: string | null = null;
  let socket: SocketLike | null = null;
  let status: StreamStatus = 'stopped';
  let attempt = 0;
  let backoff = reconnectMinMs;
  let stopped = true;
  let started = false;
  let authFailed = false;
  let reconnectTimer: TimerHandle | null = null;
  let watchdogTimer: TimerHandle | null = null;
  const seen: string[] = [];
  const seenSet = new Set<string>();

  function setStatus(next: StreamStatus): void {
    if (status === next) return;
    status = next;
    options.onStatus?.(next);
  }

  function clearWatchdog(): void {
    if (watchdogTimer === null) return;
    clearT(watchdogTimer);
    watchdogTimer = null;
  }

  function armWatchdog(): void {
    clearWatchdog();
    if (staleAfterMs <= 0) return;
    watchdogTimer = setT(() => {
      watchdogTimer = null;
      dropSocket();
      scheduleReconnect();
    }, staleAfterMs);
  }

  function dropSocket(): void {
    const current = socket;
    socket = null;
    if (current === null) return;
    current.onopen = null;
    current.onmessage = null;
    current.onerror = null;
    current.onclose = null;
    try {
      current.close();
    } catch {
      // socket already gone
    }
  }

  function remember(id: string): boolean {
    if (seenSet.has(id)) return false;
    seenSet.add(id);
    seen.push(id);
    if (seen.length > SEEN_LIMIT) {
      const dropped = seen.shift();
      if (dropped !== undefined) seenSet.delete(dropped);
    }
    return true;
  }

  function handleMessage(raw: unknown): void {
    const event = parseStreamEvent(raw);
    if (event === null) return;
    backoff = reconnectMinMs;
    armWatchdog();
    if (event.id !== undefined && event.id !== null) {
      const id = String(event.id);
      // Replayed events repeat after a reconnect; hand each one up once.
      if (!remember(id)) return;
      // Heartbeat ids are "hb-<ms>", not replay cursors (src/stream.js:207).
      if (event.type !== 'daemon.heartbeat') {
        cursor = id;
        cursorStore.save(id).catch(() => {});
      }
    }
    options.onEvent?.(event);
  }

  async function probeUnauthorized(): Promise<void> {
    const probe = options.probeUnauthorized;
    if (!probe) return;
    let unauthorized = false;
    try {
      unauthorized = await probe();
    } catch {
      unauthorized = false;
    }
    if (!unauthorized || stopped) return;
    authFailed = true;
    if (reconnectTimer !== null) {
      clearT(reconnectTimer);
      reconnectTimer = null;
    }
    setStatus('auth');
  }

  function scheduleReconnect(): void {
    if (stopped || authFailed) return;
    clearWatchdog();
    if (reconnectTimer !== null) {
      clearT(reconnectTimer);
      reconnectTimer = null;
    }
    attempt += 1;
    setStatus('reconnecting');
    if (options.probeUnauthorized) probeUnauthorized().catch(() => {});
    const delay = backoff;
    backoff = Math.min(backoff * 2, reconnectMaxMs);
    reconnectTimer = setT(() => {
      reconnectTimer = null;
      connectNow();
    }, delay);
  }

  function connectNow(): void {
    if (stopped || authFailed) return;
    setStatus(attempt === 0 ? 'connecting' : 'reconnecting');
    let next: SocketLike;
    try {
      next = socketFactory(streamURL(host, token, cursor));
    } catch {
      scheduleReconnect();
      return;
    }
    socket = next;
    next.onopen = () => {
      attempt = 0;
      backoff = reconnectMinMs;
      setStatus('live');
      armWatchdog();
    };
    next.onmessage = message => {
      handleMessage(message?.data);
    };
    next.onerror = () => {
      if (socket !== next) return;
      dropSocket();
      scheduleReconnect();
    };
    next.onclose = () => {
      if (socket !== next) return;
      dropSocket();
      scheduleReconnect();
    };
  }

  async function start(): Promise<void> {
    if (started) return;
    started = true;
    stopped = false;
    authFailed = false;
    if (cursor === null) {
      try {
        cursor = await cursorStore.load();
      } catch {
        cursor = null;
      }
    }
    if (stopped) return;
    attempt = 0;
    connectNow();
  }

  function stop(): void {
    stopped = true;
    clearWatchdog();
    if (reconnectTimer !== null) {
      clearT(reconnectTimer);
      reconnectTimer = null;
    }
    dropSocket();
    setStatus('stopped');
  }

  return {
    start,
    stop,
    status(): StreamStatus {
      return status;
    },
    since(): string | null {
      return cursor;
    },
  };
}
