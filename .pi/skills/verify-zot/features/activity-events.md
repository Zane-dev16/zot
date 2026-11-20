# Activity and tool events

What: Activity lists 30 newest runs (title + state + time, count in `#activityCount`); selecting a row opens its tool events in `#inspector`; `#status` shows `connecting` / `live` / `reconnecting N` / `offline` / `unpaired` / `auth failed` (`data-kind` = `connecting|live|reconnecting|offline|auth`), `#retryNow` retries at once.
Reach: `/` (or `#/activity`) → `#view-activity` holding the rows on `#activity`, `#refreshActivity` reloads, a row click opens `#inspector`; or `GET /api/v1/runs` + `GET /api/v1/runs/:id/events?since=0`. There is no `#activityWrap`.
Drive: create 1 run, `GET /api/v1/runs` (newest first, max 100), `GET .../events?since=0` (max 200 rows, id order), `since` filters to `id > N`.
Prove: run appears in list JSON; events JSON non-empty with `tool`, `args_hash`, `result_ref`.
