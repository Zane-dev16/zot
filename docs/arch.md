# zot v0 domain model and architecture

## Goal

zot is an always on agent host. It runs on Linux, Mac, and PC from one command. It serves a localhost browser UI. It pairs with an iOS app. It runs agents continuously through restarts.

## Stack choice

Runtime is Node with TypeScript. Storage is SQLite in one file. UI is static files served by the daemon. Binary ships as one file via Bun compile or pkg. Service installs via launchd on Mac and systemd on Linux. Windows uses Task Scheduler with the same binary.

Rationale is boring parts. Node owns HTTP plus WebSocket plus static serving in one process. SQLite needs no server and survives crashes. One binary removes install steps.

## Domain shapes

Shapes are named first. SQLite tables match the TypeScript types one to one. All timestamps are Unix millis in UTC. All ids are `TEXT` ULIDs.

### Daemon

```ts
type Daemon = {
  id: string
  startedAt: number
  heartbeatAt: number
  version: string
  dataDir: string
  state: "starting" | "ready" | "draining" | "stopped"
}
```

One row only. Startup reconciles this row. Crash leaves a stale row and the next boot reclaims it.

### AgentRun

```ts
type RunState = "queued" | "running" | "waiting_tool" | "done" | "failed" | "cancelled"

type AgentRun = {
  id: string
  title: string
  prompt: string
  state: RunState
  attempt: number
  createdAt: number
  updatedAt: number
  finishedAt: number | null
  lastHeartbeat: number
  ownerDeviceId: string | null
}
```

State is a machine. Transitions are listed here.

Allowed list:

```text
queued -> running
running -> waiting_tool
waiting_tool -> running
running -> done
running -> failed
waiting_tool -> failed
queued -> cancelled
running -> cancelled
waiting_tool -> cancelled
```

### ToolLease

```ts
type ToolLease = {
  id: string
  runId: string
  tool: string
  argsHash: string
  state: "held" | "done" | "expired"
  acquiredAt: number
  expiresAt: number
  releasedAt: number | null
}
```

One tool execution holds one lease. Expiry frees stuck runs. Retry uses the same idempotency key in `argsHash`.

### MemoryItem

```ts
type MemoryItem = {
  id: string
  runId: string | null
  key: string
  value: string
  createdAt: number
  updatedAt: number
}
```

Memory is a key value store with history by `key`. Global rows have null `runId`. Run scoped rows link to a run.

### DeviceSession

```ts
type DeviceSession = {
  id: string
  label: string
  kind: "browser" | "ios"
  tokenHash: string
  createdAt: number
  lastSeenAt: number
  revokedAt: number | null
}
```

Tokens never sit in the database in cleartext. Only SHA-256 hashes persist.

### SchedulerJob

```ts
type SchedulerJob = {
  id: string
  name: string
  cron: string
  prompt: string
  enabled: boolean
  nextRunAt: number
  lastRunId: string | null
}
```

Scheduler is polling. Each tick claims due jobs by compare and set on `nextRunAt`. Repeat runs converge to the same schedule.

## SQLite schema

Schema mirrors the types above. Foreign keys are on. WAL mode is on.

```sql
CREATE TABLE daemon(
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  heartbeat_at INTEGER NOT NULL,
  version TEXT NOT NULL,
  data_dir TEXT NOT NULL,
  state TEXT NOT NULL
);
CREATE TABLE agent_run(
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  state TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER,
  last_heartbeat INTEGER NOT NULL,
  owner_device_id TEXT
);
CREATE TABLE tool_lease(
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_run(id) ON DELETE CASCADE,
  tool TEXT NOT NULL,
  args_hash TEXT NOT NULL,
  state TEXT NOT NULL,
  acquired_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  released_at INTEGER,
  UNIQUE(run_id, args_hash)
);
CREATE TABLE memory_item(
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES agent_run(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_memory_key ON memory_item(key);
CREATE TABLE device_session(
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  kind TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE TABLE scheduler_job(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cron TEXT NOT NULL,
  prompt TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at INTEGER NOT NULL,
  last_run_id TEXT
);
```

## Daemon supervisor

The daemon is one process. It owns the HTTP server, the scheduler tick, and run reaping. Startup is convergent. Each boot performs the same steps.

Startup steps:

```text
open SQLite and run migrations
upsert daemon row with new boot id
mark running runs older than 60s as queued with attempt plus one
mark held leases past expiresAt as expired
recompute nextRunAt for scheduler jobs
start HTTP on 127.0.0.1 with a fixed port and serve UI
```

Shutdown drains. SIGTERM flips state to draining. It waits 10s for runs to checkpoint. Then it exits. A second boot resumes queued work.

Liveness is `GET /healthz`. It returns version and daemon state. Supervisors poll it. launchd uses `KeepAlive`. systemd uses `Restart=always`.

## Agent loop

Each run executes in a worker thread or child process. The loop has five steps. Each step checkpoints to SQLite before acting.

Loop steps:

```text
claim queued row by id with state compare and set
load prompt plus memory keys for the run
call the model and stream tokens to the event log
request a tool through the gateway or emit final output
write done or failed and release leases
```

Heartbeats update `lastHeartbeat` every 5s. The supervisor requeues runs with stale heartbeats. Retries increment `attempt` and cap at five. Same input replays to the same end state.

## Tool gateway

All tool calls pass through one function. Direct tool imports from run code are out. The gateway checks three things in order.

Checks:

```text
run holds a live lease or can acquire one
tool name is in the allowlist
args match the zod schema for that tool
```

Shell and file tools run with a cwd jail and a timeout. Network tools need an explicit flag. Every call appends to an append only `tool_event` log with run id, tool, hash, and result ref.

## Local HTTP API

Base path is `/api/v1`. JSON only. Auth is a bearer token on every route except health and pairing start.

Routes:

```text
GET /healthz
GET /api/v1/runs
POST /api/v1/runs
GET /api/v1/runs/:id
POST /api/v1/runs/:id/cancel
GET /api/v1/runs/:id/events
POST /api/v1/runs/:id/approve
GET /api/v1/memory?key=
PUT /api/v1/memory/:key
GET /api/v1/jobs
POST /api/v1/jobs
PATCH /api/v1/jobs/:id
DELETE /api/v1/jobs/:id
GET /api/v1/devices
POST /api/v1/pair/start
POST /api/v1/pair/confirm
DELETE /api/v1/devices/:id
GET /api/v1/stream
```

`POST /api/v1/runs` accepts title, prompt, and optional owner device id. It returns the queued run. `POST /api/v1/runs/:id/approve` releases a `waiting_tool` run back to running. Pairing routes are rate limited to five tries per minute.

Browser UI is static files at `/` served by the same port. iOS uses the same routes over LAN with a device token.

## WebSocket stream

Path is `/api/v1/stream`. Token passes as query param `token` on connect. Server pushes newline delimited JSON events.

Event types:

```text
run.created
run.state
run.token
tool.request
tool.result
run.done
daemon.heartbeat
```

Clients resume with `?since=<eventId>`. Server replays from the event log. Missed events arrive in order. No event is lost on reconnect.

## Auth token model

One owner token exists at first boot. It prints once to the terminal. It is stored hashed in `device_session`. Browser login saves it in localStorage. iOS pairs with a six digit code shown in the browser UI.

Pairing flow:

```text
browser calls pair start and shows a six digit code
phone calls pair confirm with the code within five minutes
server issues a device token and stores only its hash
phone stores the cleartext token in the keychain
```

Tokens are 256 bit random hex. Every request compares hashes in constant time. Revoke sets `revokedAt`. LAN exposure binds to the LAN interface only when pairing mode is on. Default bind is loopback.

## Deployment

Install is one command. It writes the binary, the data dir, and the service file. Data lives in `~/.zot` with `zot.db` and `zot.key`.

Service files:

```text
Mac launchd plist with KeepAlive true
systemd unit with Restart always and WantedBy default target
Windows scheduled task that starts the binary at logon
```

Upgrades run migrations on boot. Downgrades are out of scope for v0.

## Track split

Tracks are ordered for parallel builds after the schema lands.

List:

```text
Track 1. Daemon plus SQLite plus supervisor and health route
Track 2. AgentRun loop plus heartbeat plus retry and cancel routes
Track 3. Tool gateway plus leases plus approve flow
Track 4. Auth plus pairing plus device sessions
Track 5. Scheduler jobs plus tick plus job routes
Track 6. WebSocket stream plus event log plus browser UI shell
Track 7. iOS pairing plus LAN mode plus memory routes
```

Track 1 is the base. Tracks 2 through 5 build on it in parallel. Tracks 6 and 7 close last.

## Open decisions

Two calls need an operator verdict. Default is recorded for each.

List:

```text
Node runtime as Bun versus plain Node. Default is plain Node for wider compat.
Port default as 8787 versus auto pick. Default is fixed 8787 for bookmarking.
```
