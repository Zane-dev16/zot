# API

Auth is Bearer token on every api route except pair start. Health and static web are public. Pair confirm currently requires auth in code. Failures return JSON error. Missing token returns 401 unauthorized.

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

Authed memory routes in this list.

```text
GET /api/v1/memory lists items, supports key plus q plus runId plus limit
PUT /api/v1/memory/:key creates or updates one key, needs string value
```

Authed job routes in this list.

```text
GET /api/v1/jobs lists jobs by name
POST /api/v1/jobs creates a job, needs name plus cron plus prompt
PATCH /api/v1/jobs/:id updates name plus cron plus prompt plus enabled plus nextRunAt
DELETE /api/v1/jobs/:id deletes a job
```

Authed device routes in this list.

```text
GET /api/v1/devices lists sessions
POST /api/v1/pair/confirm issues a token, needs pending code
DELETE /api/v1/devices/:id revokes a session
```

Stream route in this list.

```text
GET /api/v1/stream is a WebSocket upgrade, auth by token query
```

Note on pair confirm. The iOS stub calls it without auth. The server currently enforces auth. Decide one model before shipping pairing.
