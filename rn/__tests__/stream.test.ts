import type { AgentRun } from '../src/api/client';
import type {
  StreamEvent,
  StreamOptions,
  StreamStatus,
} from '../src/api/stream';
import {
  applyRunEvent,
  connectStream,
  createMemoryCursorStore,
  HEARTBEAT_MS,
  parseStreamEvent,
  streamURL,
} from '../src/api/stream';
import { makeClock, makeSocketPool } from '../test-support/fakes';

function setup(overrides: Partial<StreamOptions> = {}) {
  const clock = makeClock();
  const pool = makeSocketPool();
  const events: StreamEvent[] = [];
  const statuses: StreamStatus[] = [];
  const cursor = overrides.cursorStore ?? createMemoryCursorStore();
  const handle = connectStream('127.0.0.1:8787', 'tok-1', {
    socketFactory: pool.factory,
    cursorStore: cursor,
    onEvent: event => events.push(event),
    onStatus: status => statuses.push(status),
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    ...overrides,
  });
  return { clock, pool, events, statuses, cursor, handle };
}

async function flush(): Promise<void> {
  await new Promise<void>(resolve => {
    setTimeout(() => resolve(), 0);
  });
}

describe('streamURL (web/app.js:237-245)', () => {
  test('maps the paired host onto ws:// + token', () => {
    expect(streamURL('127.0.0.1:8787', 'tok-1')).toBe(
      'ws://127.0.0.1:8787/api/v1/stream?token=tok-1',
    );
    expect(streamURL('http://192.168.68.56:8787/', 'tok-1')).toBe(
      'ws://192.168.68.56:8787/api/v1/stream?token=tok-1',
    );
  });

  test('https hosts map to wss and values are encoded', () => {
    expect(streamURL('https://zot.example.ts.net', 'tok/1')).toBe(
      'wss://zot.example.ts.net/api/v1/stream?token=tok%2F1',
    );
  });

  test('adds since only when there is a cursor', () => {
    expect(streamURL('127.0.0.1:8787', 'tok-1', '42')).toBe(
      'ws://127.0.0.1:8787/api/v1/stream?token=tok-1&since=42',
    );
    expect(streamURL('127.0.0.1:8787', 'tok-1', '')).toBe(
      'ws://127.0.0.1:8787/api/v1/stream?token=tok-1',
    );
    expect(streamURL('127.0.0.1:8787', 'tok-1', null)).toBe(
      'ws://127.0.0.1:8787/api/v1/stream?token=tok-1',
    );
  });

  test('refuses an empty host', () => {
    expect(() => streamURL('   ', 'tok-1')).toThrow(
      'Invalid host. Add http:// and check host.',
    );
  });
});

describe('parseStreamEvent', () => {
  test('parses a daemon event', () => {
    expect(
      parseStreamEvent('{"id":"3","type":"run.state","runId":"r1"}'),
    ).toEqual({ id: '3', type: 'run.state', runId: 'r1' });
  });

  test('ignores junk frames instead of throwing', () => {
    expect(parseStreamEvent('not json')).toBe(null);
    expect(parseStreamEvent('')).toBe(null);
    expect(parseStreamEvent('["array"]')).toBe(null);
    expect(parseStreamEvent('{"id":"1"}')).toBe(null);
    expect(parseStreamEvent(undefined)).toBe(null);
  });
});

describe('connectStream', () => {
  test('connects, reports status and reconnects with the persisted cursor', async () => {
    const cursor = createMemoryCursorStore('41');
    const s = setup({ cursorStore: cursor });

    await s.handle.start();
    expect(s.pool.created).toHaveLength(1);
    expect(s.pool.last().url).toBe(
      'ws://127.0.0.1:8787/api/v1/stream?token=tok-1&since=41',
    );
    expect(s.statuses).toEqual(['connecting']);

    s.pool.last().open();
    expect(s.statuses).toEqual(['connecting', 'live']);
    expect(s.handle.status()).toBe('live');
  });

  test('first start has no since parameter', async () => {
    const s = setup();
    await s.handle.start();
    expect(s.pool.last().url).toBe(
      'ws://127.0.0.1:8787/api/v1/stream?token=tok-1',
    );
  });

  test('hands events up and persists the last replay cursor', async () => {
    const s = setup();
    await s.handle.start();
    s.pool.last().open();
    s.pool.last().message({
      id: '7',
      type: 'run.state',
      runId: 'r1',
      state: 'running',
    });

    expect(s.events.map(event => event.type)).toEqual(['run.state']);
    expect(s.events[0].state).toBe('running');
    expect(await s.cursor.load()).toBe('7');
    expect(s.handle.since()).toBe('7');
  });

  test('heartbeats keep the socket alive without moving the cursor', async () => {
    const s = setup();
    await s.handle.start();
    s.pool.last().open();
    s.pool.last().message({
      id: '9',
      type: 'run.done',
      runId: 'r1',
      state: 'done',
    });
    s.pool.last().message({
      id: 'hb-1700000000000',
      type: 'daemon.heartbeat',
      at: 1700000000000,
    });

    expect(s.events.map(event => event.type)).toEqual([
      'run.done',
      'daemon.heartbeat',
    ]);
    expect(await s.cursor.load()).toBe('9');
  });

  test('a replayed id is handed up once', async () => {
    const s = setup();
    await s.handle.start();
    s.pool.last().open();
    s.pool.last().message({ id: '5', type: 'run.state', runId: 'r1' });
    s.pool.last().message({ id: '5', type: 'run.state', runId: 'r1' });
    expect(s.events).toHaveLength(1);
  });

  test('one bad frame does not kill the stream', async () => {
    const s = setup();
    await s.handle.start();
    s.pool.last().open();
    s.pool.last().message('{not json');
    s.pool.last().message({ id: '2', type: 'run.state', runId: 'r1' });
    expect(s.events).toHaveLength(1);
    expect(s.handle.status()).toBe('live');
  });

  test('reconnects after a server close with the updated cursor', async () => {
    const s = setup();
    await s.handle.start();
    s.pool.last().open();
    s.pool.last().message({ id: '12', type: 'run.state', runId: 'r1' });
    s.pool.last().serverClose();

    expect(s.statuses).toEqual(['connecting', 'live', 'reconnecting']);
    expect(s.pool.created).toHaveLength(1);
    s.clock.tick(999);
    expect(s.pool.created).toHaveLength(1);
    s.clock.tick(1);
    expect(s.pool.created).toHaveLength(2);
    expect(s.pool.last().url).toContain('since=12');
  });

  test('backs off exponentially up to the cap', async () => {
    const s = setup({ reconnectMaxMs: 4000 });
    await s.handle.start();
    s.pool.last().open();

    // 1000ms, then 2000ms, then capped at 4000ms.
    s.pool.last().serverClose();
    s.clock.tick(1000);
    expect(s.pool.created).toHaveLength(2);

    s.pool.last().serverClose();
    s.clock.tick(1999);
    expect(s.pool.created).toHaveLength(2);
    s.clock.tick(1);
    expect(s.pool.created).toHaveLength(3);

    s.pool.last().serverClose();
    s.clock.tick(3999);
    expect(s.pool.created).toHaveLength(3);
    s.clock.tick(1);
    expect(s.pool.created).toHaveLength(4);

    s.pool.last().serverClose();
    s.clock.tick(4000);
    expect(s.pool.created).toHaveLength(5);
  });

  test('a successful open resets the backoff', async () => {
    const s = setup();
    await s.handle.start();
    s.pool.last().open();
    s.pool.last().serverClose();
    s.clock.tick(1000);
    s.pool.last().open();
    s.pool.last().serverClose();
    s.clock.tick(1000);
    expect(s.pool.created).toHaveLength(3);
  });

  test('drops a socket that misses two heartbeats and reconnects', async () => {
    const s = setup();
    await s.handle.start();
    s.pool.last().open();
    const first = s.pool.last();

    s.clock.tick(HEARTBEAT_MS * 2 - 1);
    expect(first.closed).toBe(false);
    s.clock.tick(1);
    expect(first.closed).toBe(true);
    expect(s.statuses).toContain('reconnecting');

    s.clock.tick(1000);
    expect(s.pool.created).toHaveLength(2);
  });

  test('incoming heartbeats keep the socket alive', async () => {
    const s = setup();
    await s.handle.start();
    s.pool.last().open();
    const first = s.pool.last();

    for (let beat = 0; beat < 4; beat += 1) {
      s.clock.tick(HEARTBEAT_MS - 1);
      first.message({ id: 'hb-' + beat, type: 'daemon.heartbeat' });
    }
    expect(first.closed).toBe(false);
    expect(s.pool.created).toHaveLength(1);
  });

  test('an error event reconnects without waiting for a close', async () => {
    const s = setup();
    await s.handle.start();
    s.pool.last().open();
    s.pool.last().fail();
    expect(s.pool.last().closed).toBe(true);
    s.clock.tick(1000);
    expect(s.pool.created).toHaveLength(2);
  });

  test('stops retrying when the token is rejected', async () => {
    const s = setup({ probeUnauthorized: async () => true });
    await s.handle.start();
    s.pool.last().open();
    s.pool.last().serverClose();
    await flush();

    expect(s.statuses).toContain('auth');
    s.clock.tick(60000);
    expect(s.pool.created).toHaveLength(1);
  });

  test('keeps retrying while the probe does not report 401', async () => {
    const s = setup({ probeUnauthorized: async () => false });
    await s.handle.start();
    s.pool.last().open();
    s.pool.last().serverClose();
    await flush();

    expect(s.statuses).not.toContain('auth');
    s.clock.tick(1000);
    expect(s.pool.created).toHaveLength(2);
  });

  test('stop closes the socket and cancels pending retries', async () => {
    const s = setup();
    await s.handle.start();
    s.pool.last().open();
    const socket = s.pool.last();
    s.pool.last().serverClose();
    s.handle.stop();

    expect(socket.closed).toBe(true);
    expect(s.handle.status()).toBe('stopped');
    s.clock.tick(60000);
    expect(s.pool.created).toHaveLength(1);
  });

  test('start is idempotent', async () => {
    const s = setup();
    await s.handle.start();
    await s.handle.start();
    expect(s.pool.created).toHaveLength(1);
  });
});

describe('applyRunEvent (web/app.js:190-235)', () => {
  const base: AgentRun[] = [
    { id: 'r1', title: 'hello', prompt: 'say hi', state: 'queued' },
    { id: 'r2', title: 'other', prompt: 'do it', state: 'running' },
  ];

  test('folds run.state, tool.request and run.done into the matching run', () => {
    const running = applyRunEvent(base, {
      id: '1',
      type: 'run.state',
      runId: 'r1',
      state: 'running',
    });
    expect(running[0].state).toBe('running');
    expect(running[1]).toBe(base[1]);

    const waiting = applyRunEvent(running, {
      id: '2',
      type: 'tool.request',
      runId: 'r1',
      tool: 'shell',
    });
    expect(waiting[0].state).toBe('waiting_tool');

    const done = applyRunEvent(waiting, {
      id: '3',
      type: 'run.done',
      runId: 'r1',
      state: 'done',
    });
    expect(done[0].state).toBe('done');
  });

  test('run.done without a state falls back to done', () => {
    const done = applyRunEvent(base, {
      id: '3',
      type: 'run.done',
      runId: 'r2',
    });
    expect(done[1].state).toBe('done');
  });

  test('run.created updates the title of a known run', () => {
    const created = applyRunEvent(base, {
      id: '4',
      type: 'run.created',
      runId: 'r2',
      title: 'renamed',
    });
    expect(created[1].title).toBe('renamed');
  });

  test('returns the same array when nothing list-visible changed', () => {
    expect(applyRunEvent(base, { id: '5', type: 'daemon.heartbeat' })).toBe(
      base,
    );
    expect(
      applyRunEvent(base, {
        id: '6',
        type: 'run.token',
        runId: 'r1',
        token: 'tok',
      }),
    ).toBe(base);
    expect(
      applyRunEvent(base, {
        id: '7',
        type: 'run.state',
        runId: 'r1',
        state: 'queued',
      }),
    ).toBe(base);
  });

  test('ignores events for runs the list does not know yet', () => {
    expect(
      applyRunEvent(base, {
        id: '8',
        type: 'run.done',
        runId: 'r-missing',
        state: 'done',
      }),
    ).toBe(base);
  });
});
