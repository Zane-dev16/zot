---
name: verify-zot
description: Verify zot daemon plus browser chat for personal automation. HTTP service on 8787 with web UI, api v1, websocket stream. Use for any zot run, approval, activity, pairing, or memory/job change.
---

# Verify zot

Local-first daemon + browser chat. `src/daemon2.js` serves health + web + api on port 8787. No build, no npm install for default path. Node 22+ and curl only.

## Launch

Boot on an isolated port + tmp db so two instances run side by side:

```sh
TMPDIR="$(mktemp -d)"; DB="$TMPDIR/zot.db"; LOG="$TMPDIR/daemon.log"
PORT=18787 ZOT_DB="$DB" node src/daemon2.js >"$LOG" 2>&1 &
echo $! > "$TMPDIR/pid"
```

Ready when health answers (poll up to ~15s, same as `scripts/prove.sh`):

```sh
for _ in $(seq 1 75); do curl -s -f -o /dev/null http://127.0.0.1:18787/healthz && break; sleep 0.2; done
curl -s http://127.0.0.1:18787/healthz
# expect {"state":"ready",...}
```

Teardown: kill the saved PID only, then remove tmpdir. Never `pkill node`:

```sh
kill "$(cat $TMPDIR/pid)" 2>/dev/null || true; wait "$(cat $TMPDIR/pid)" 2>/dev/null || true
cp "$LOG" <evidence-dir>/daemon.log  # before rm
rm -rf "$TMPDIR"
```

Default port 8787 collides; always override `PORT` plus `ZOT_DB` per run. Env is optional otherwise (`PORT`, `ZOT_DB`/`ZOT_DATA_DIR`; live models need `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`, chatops needs `CHATOPS_INBOUND_SECRET`).

## Doctor

One read-only check — is this instance worth driving?

```sh
curl -s http://127.0.0.1:18787/healthz | grep -q '"state":"ready"'
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:18787/api/v1/runs  # expect 401, proves auth gate
test -f web/index.html && test -f web/app.js
```

If health is not `ready`, stop and read `$LOG`. If `/api/v1/runs` is not 401 without token, the instance is wrong — do not drive it.

## Drive

Plain HTTP is the harness — no Playwright/Cypress in repo. `scripts/prove.sh` is the boot pattern; `scripts/verify-*.js` are offline unit checks (`node scripts/verify-approvals.js`).

Pair once per instance (public routes, rate-limited):

```sh
B=http://127.0.0.1:18787
CODE=$(curl -s -X POST $B/api/v1/pair/start -d '{"label":"verify","kind":"browser"}' -H 'content-type: application/json' | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).code")
TOKEN=$(curl -s -X POST $B/api/v1/pair/confirm -d "{\"code\":\"$CODE\"}" -H 'content-type: application/json' | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).token")
AUTH="Authorization: Bearer $TOKEN"
```

Chat send (offline echo model, no API keys needed — daemon polls every 1s):

```sh
RUN=$(curl -s -X POST $B/api/v1/runs -H "$AUTH" -H 'content-type: application/json' -d '{"title":"hello","prompt":"hello verify"}' | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).run.id")
sleep 3
curl -s $B/api/v1/runs/$RUN -H "$AUTH"  # expect state done
```

Approvals (any prompt starting `tool:` pauses with `waiting_tool`):

```sh
RUN=$(curl -s -X POST $B/api/v1/runs -H "$AUTH" -H 'content-type: application/json' -d '{"title":"tool","prompt":"tool: shell echo hi"}' | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).run.id")
sleep 2
curl -s $B/api/v1/runs/$RUN -H "$AUTH"  # expect waiting_tool
curl -s -X POST $B/api/v1/runs/$RUN/approve -H "$AUTH"  # -> running, then done
curl -s "$B/api/v1/runs/$RUN/events?since=0" -H "$AUTH"  # tool_event with output
```

Activity + browser UI selectors (stable handles, no coordinates):

- Open `http://127.0.0.1:18787/` → `#token` (aria `Device token`) + `#saveToken`, `#box` (aria `Prompt`) in `#composer`, `#status` (`live` vs `reconnecting` + `#retryCount`/`#retryNow`), `#activity` rows + per-row `Show tool events for …` button + `#refreshActivity`.
- `GET /api/v1/runs` lists 100 newest; Activity renders newest 30 with title + state + time and count in `#activityCount`.

## Evidence

Capture action plus resulting state to `<evidence-dir>/` (proof artifacts survive cleanup — copy before `rm -rf $TMPDIR`):

- `health.json` — full `/healthz` body
- `run.json` — `GET /api/v1/runs/:id` showing terminal state (`done`)
- `events.json` — `GET /api/v1/runs/:id/events?since=0` showing side effects
- `daemon.log` — tail of daemon log on failure

Verify side effects alongside what is visible: run state `done` AND `tool_event` row / `result_ref` present. A 401 without token and 409 on bad approve→cancel transition are pass criteria, not failures.

## Cleanup

Kill by saved PID, preserve evidence first (see Launch). Confirm evidence still exists after `rm -rf $TMPDIR`:

```sh
ls <evidence-dir>/health.json <evidence-dir>/run.json
```

Isolation: side-by-side safe via distinct `PORT` + `ZOT_DB`. Default `PORT 8787` + `~/.zot/zot.db` collides — never verify against a dev instance you did not boot.
