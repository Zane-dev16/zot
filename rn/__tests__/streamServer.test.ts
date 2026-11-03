// Stream against a real WebSocket server (node `ws` on the server side, the
// runtime's WHATWG WebSocket on the client side). This is the closest Linux
// proof of the wire contract short of a device: handshake, replay, live
// frames, cursor persistence and reconnect-with-since all cross a socket.

import type { StreamEvent, StreamStatus } from '../src/api/stream';
import {
  connectStream,
  createMemoryCursorStore,
  STREAM_PATH,
} from '../src/api/stream';
import { waitFor } from '../test-support/fakes';

function loadWs(): typeof import('ws') | null {
  try {
    return jest.requireActual<typeof import('ws')>('ws');
  } catch {
    return null;
  }
}

const ws = loadWs();
const describeWs = ws === null ? describe.skip : describe;

// id 2 deliberately exceeds 125 payload bytes: the daemon's own encoder
// (src/stream.js encodeText, out of this lane) throws on those, so this proves
// the client side handles long frames regardless.
const LONG_TOKEN = 'x'.repeat(400);
const REPLAY: StreamEvent[] = [
  { id: '1', type: 'run.state', runId: 'r1', state: 'running' },
  { id: '2', type: 'run.token', runId: 'r1', token: LONG_TOKEN },
  { id: '3', type: 'run.done', runId: 'r1', state: 'done' },
];

type Harness = {
  port: number;
  requests: string[];
  connections: { socket: { send(data: string): void; close(): void } }[];
  close(): Promise<void>;
};

async function startServer(): Promise<Harness> {
  if (ws === null) throw new Error('ws is not installed');
  const requests: string[] = [];
  const connections: Harness['connections'] = [];
  const sent = new Set<number>();
  const server = new ws.Server({ port: 0, host: '127.0.0.1' }, () => {});
  await new Promise<void>(resolve => {
    const tick = setInterval(() => {
      if (server.address() !== null) {
        clearInterval(tick);
        resolve();
      }
    }, 5);
  });
  const port = server.address()?.port ?? 0;

  server.on('connection', (socket, request) => {
    const url = String(request.url ?? '');
    requests.push(url);
    connections.push({ socket });
    const since = Number(
      new URL(url, 'http://localhost').searchParams.get('since') ?? 0,
    );
    for (const event of REPLAY) {
      if (Number(event.id) <= since) continue;
      socket.send(JSON.stringify(event));
    }
    // One live frame after the replay, like a run starting on this daemon.
    const timer = setTimeout(() => {
      sent.add(1);
      socket.send(
        JSON.stringify({
          id: '4',
          type: 'run.state',
          runId: 'r1',
          state: 'waiting_tool',
        }),
      );
    }, 20);
    socket.on('close', () => clearTimeout(timer));
  });

  return {
    port,
    requests,
    connections,
    async close() {
      for (const connection of connections) {
        try {
          connection.socket.close();
        } catch {
          // already gone
        }
      }
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

describeWs('stream over a real websocket', () => {
  test('replays from the cursor, streams live events and reconnects with since', async () => {
    const server = await startServer();
    const events: StreamEvent[] = [];
    const statuses: StreamStatus[] = [];
    const cursor = createMemoryCursorStore('0');
    const handle = connectStream('127.0.0.1:' + server.port, 'tok-ws', {
      cursorStore: cursor,
      onEvent: event => events.push(event),
      onStatus: status => statuses.push(status),
      heartbeatMs: 0,
      reconnectMinMs: 20,
    });

    try {
      await handle.start();
      await waitFor(() => events.length >= 4);

      expect(server.requests[0]).toBe(STREAM_PATH + '?token=tok-ws&since=0');
      expect(events.map(event => event.id)).toEqual(['1', '2', '3', '4']);
      expect(events[1].token).toBe(LONG_TOKEN);
      expect(JSON.stringify(events[1]).length).toBeGreaterThan(400);
      expect(handle.status()).toBe('live');
      expect(statuses).toContain('live');
      expect(await cursor.load()).toBe('4');

      // Server drops the socket: the client must reconnect with since=4
      // and the server must replay nothing already seen.
      server.connections[0].socket.close();
      await waitFor(() => server.requests.length >= 2);
      expect(server.requests[1]).toBe(STREAM_PATH + '?token=tok-ws&since=4');
      await new Promise<void>(resolve => {
        setTimeout(() => resolve(), 50);
      });
      expect(events.map(event => event.id)).toEqual(['1', '2', '3', '4']);
      expect(events[1].token).toBe(LONG_TOKEN);
      expect(JSON.stringify(events[1]).length).toBeGreaterThan(400);
    } finally {
      handle.stop();
      await server.close();
    }
  });

  test('a bad token surfaces as a failed connection that keeps retrying', async () => {
    if (ws === null) throw new Error('ws is not installed');
    const attempts: string[] = [];
    const server = new ws.Server({ port: 0, host: '127.0.0.1' }, () => {});
    await new Promise<void>(resolve => {
      const tick = setInterval(() => {
        if (server.address() !== null) {
          clearInterval(tick);
          resolve();
        }
      }, 5);
    });
    const port = server.address()?.port ?? 0;
    server.on('connection', (socket, request) => {
      attempts.push(String(request.url ?? ''));
      socket.close();
    });

    const statuses: StreamStatus[] = [];
    const handle = connectStream('127.0.0.1:' + port, 'tok-ws', {
      cursorStore: createMemoryCursorStore(),
      onStatus: status => statuses.push(status),
      heartbeatMs: 0,
      reconnectMinMs: 10,
    });

    try {
      await handle.start();
      await waitFor(() => attempts.length >= 2);
      expect(statuses).toContain('reconnecting');
    } finally {
      handle.stop();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
