# API

Auth is Bearer token on every api route except pair start. Health and static web are public. Failures return JSON error. Missing token returns 401 unauthorized. Bad run transitions return 409.

Public routes in this list.

```text
GET /healthz returns version plus state plus uptime
POST /api/v1/pair/start returns code plus expiresAt, rate limited
GET / returns browser UI
GET /index.html plus /app.js plus /style.css serve web files
```

Authed run routes in this list.

```text
GET /api/v1/runs lists 100 newest runs
POST /api/v1/runs creates a run, needs title plus prompt
GET /api/v1/runs/:id fetches one run
POST /api/v1/runs/:id/cancel cancels a run
POST /api/v1/runs/:id/approve approves a run
GET /api/v1/runs/:id/events lists tool events, supports since
```

Run states in this list.

```text
queued runs on claim
running is active
waiting_tool needs approval
done is terminal success
failed is terminal failure
cancelled is terminal cancel
```

Approve moves waiting_tool to running. It also accepts queued to running. Cancel moves queued, running, or waiting_tool to cancelled. Terminal states accept no transitions.

Events query in this list.

```text
GET /api/v1/runs/:id/events returns id plus run_id plus tool plus args_hash plus result_ref plus created_at
since filters to id greater than the given value, default 0
limit is 200 rows in id order
unknown run id returns 404
```

Authed memory routes in this list.

```text
GET /api/v1/memory lists items, supports key plus q plus runId plus limit
PUT /api/v1/memory/:key creates or updates one key, needs string value
```

Memory query defaults to 20 rows and caps at 100 rows. A q search tries FTS first and falls back to LIKE. Results state via fts or via like.

Authed job routes in this list.

```text
GET /api/v1/jobs lists jobs by name with runCount plus recentRuns
POST /api/v1/jobs creates a job, needs name plus cron plus prompt, bad cron returns 400
PATCH /api/v1/jobs/:id updates name plus cron plus prompt plus enabled plus nextRunAt, bad cron returns 400, cron change recomputes nextRunAt
DELETE /api/v1/jobs/:id deletes a job

Each scheduler fire writes one scheduler_run row with job plus run plus fired time. GET jobs returns the count plus the newest five runs.
```

Authed device routes in this list.

```text
GET /api/v1/devices lists sessions
POST /api/v1/pair/confirm issues a token, needs pending code
DELETE /api/v1/devices/:id revokes a session
```

Pair confirm is public. Measured via 201 without token on local port 18787. The iOS stub calls it without auth. This matches the code. Rate limits apply to pair start and pair confirm.

Stream route in this list.

```text
GET /api/v1/stream is a WebSocket upgrade, auth by token query
```

The browser app uses token query plus since id for replay. Retry now is a browser stream action and calls no route here.
