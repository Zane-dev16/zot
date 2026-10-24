# Activity and tool events

What: Activity lists 30 newest runs (title + state + time, count in `#activityCount`); clicking a row loads its tool events; `#status` shows `live` / `reconnecting attempt N` / `auth failed` / `offline`, `#retryNow` retries at once.
Reach: `/` → `#activityWrap`, `#refreshActivity` reloads; or `GET /api/v1/runs` + `GET /api/v1/runs/:id/events?since=0`.
Drive: create 1 run, `GET /api/v1/runs` (newest first, max 100), `GET .../events?since=0` (max 200 rows, id order), `since` filters to `id > N`.
Prove: run appears in list JSON; events JSON non-empty with `tool`, `args_hash`, `result_ref`.
