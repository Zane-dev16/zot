# Pairing and devices

What: Bearer token comes from pairing. `POST /api/v1/pair/start` returns `{code, expiresAt}` (rate-limited); `POST /api/v1/pair/confirm` with code returns `{token, device}` 201 (public, no token). All other `/api/v1` routes need `Authorization: Bearer $TOKEN` or 401.
Reach: browser UI Start pairing, or curl pair/start → pair/confirm; iOS sets Base URL to host:port, enters 6-digit code within 5 min.
Drive: pair/start (kind must be `browser` or `ios`) → pair/confirm → save token → `GET /api/v1/devices` lists sessions → `DELETE /api/v1/devices/:id` revokes. Negative: `GET /api/v1/runs` without token → 401 JSON error.
Prove: confirm returns 201 with token; authed call 200; unauthed 401; revoked device cannot call.
