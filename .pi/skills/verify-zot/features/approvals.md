# Approvals

What: run needing approval shows highlighted card naming the waiting tool, with Approve and Cancel. Approve moves `waiting_tool`→`running`; Cancel moves to `cancelled`; bad transition returns 409.
Reach: send a prompt starting `tool:` (e.g. `tool: shell echo hi`), or click Approve in live log / Activity row.
Drive: `POST /api/v1/runs` with `tool:` prompt → expect `waiting_tool` → `POST /api/v1/runs/:id/approve` → poll to `done`. Cancel path: same setup → `POST .../cancel` → `cancelled`. Bad path: approve a `done` run → expect 409.
Prove: `run.json` terminal state + `events.json` `tool_event` with output (`hi`) or `deny:` prefix for denied tools.
