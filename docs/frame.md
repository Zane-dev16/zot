# zot program frame

## Done predicate

V0 is done when 12 must haves run from one binary.
Countable units are 7 tracks merged. 6 domain tables live. 19 API routes pass. Zero crash loops on restart. Zero unapproved writes in logs.

## Tracks

List comes from /tmp/zot-arch.md.
1. Daemon plus SQLite plus supervisor.
2. AgentRun loop plus retry plus cancel.
3. Tool gateway plus leases plus approve.
4. Auth plus pairing plus devices.
5. Scheduler plus tick plus jobs.
6. Stream plus event log plus browser UI.
7. Memory plus iOS bridge plus chatops.

## Effort

Track 1 is 2 days. It is the base.
Tracks 2 through 5 are 2 days each. They run parallel after track 1.
Tracks 6 and 7 are 3 days each. They close last.
Total is about 4 weeks for one builder. Measured in working days, not guesses.

## Pilot verdict

Pilot passes. Scaffold holds 7 files with no deps.
Heartbeat prints on stdout. Health endpoint returns 200.
Next wave is approved. Base is track 1 on port 8787.

## Next wave

### U1 Daemon base
Goal. One process survives restart.
Scope. SQLite schema plus supervisor plus GET /healthz.
Acceptance. Kill minus 9 then reboot recovers. Health returns version.

### U2 Run loop
Goal. A prompt becomes a tracked run.
Scope. AgentRun machine plus heartbeat plus cancel routes.
Acceptance. POST /api/v1/runs reaches done. Stale heartbeat requeues.

### U3 Tool gate
Goal. Every tool call is leased and approved.
Scope. Gateway plus ToolLease plus approve route.
Acceptance. Unlisted tool is denied. Expired lease frees the run.

### U4 Auth pair
Goal. Only paired devices call the API.
Scope. Token hashes plus pair start plus pair confirm.
Acceptance. Six digit code pairs iOS in 5 minutes. Revoke blocks access.

### U5 Scheduler
Goal. Natural language recurrence delivers to chat.
Scope. SchedulerJob plus tick plus job routes.
Acceptance. Cron job fires a run. Pause stops firing.

### U6 Stream UI
Goal. Browser shows live run output.
Scope. WebSocket stream plus event log plus static UI.
Acceptance. Token streams to browser. Reconnect replays missed events.

### U7 Memory bridge
Goal. One memory serves browser plus iOS plus chatops.
Scope. MemoryItem plus FTS search plus memory routes.
Acceptance. PUT then GET returns the note. Recall works across runs.
