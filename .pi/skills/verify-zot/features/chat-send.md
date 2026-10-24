# Chat send

What: user types a prompt in browser chat (`#box` in `#composer`), run appears in live log, reaches `done`.
Reach: open `/`, save device token in `#token`, type in `#box`, press Send. Or `POST /api/v1/runs` with `{title, prompt}`.
Drive: pair (see SKILL.md), `POST /api/v1/runs` with plain prompt (offline echo needs no keys), poll `GET /api/v1/runs/:id` until `done` (~3s, runner ticks 1s).
Prove: `run.json` shows `state: done`; `events.json` has one `model.exec` row.
