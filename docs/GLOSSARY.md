# Glossary

One line per term. Shared vocabulary for the daemon, the browser console, the RN client, and the Swift client.

- **Run** — one `agent_run` row: `id, title, prompt, state, attempt, createdAt, updatedAt, finishedAt, lastHeartbeat, ownerDeviceId, model?`. The unit every view lists.
- **View** — one of the four navigable surfaces: `chat`, `approvals`, `activity`, `pairing`. Persisted in the URL hash as `#/<view>` and in the store as `ui.view`.
- **Thread** — the Chat view's chronological stack of the newest 12 runs, oldest at top. Not a conversation store: zot has no multi-turn thread object, and this rework does not invent one.
- **Inspector** — the right pane. Read-only detail for one selected run, two tabs (Details, Events). Never mutates a run.
- **Approval** — the transition out of `waiting_tool` (approve → `running`, cancel → `cancelled`), also offered for `queued` (approve → `running`). Only the Approvals view performs it.
- **Pairing** — minting a device session. Three steps: start (code), display, confirm (token). The code comes back to the caller, so a browser pairing with itself is a self-pair.
- **Device token** — the bearer string stored in `localStorage["zot.token"]`. The console keeps it out of the page URL, query, and hash; the stream upgrade is the one place it rides a query, as `?token=` (`docs/API.md`).
- **Variant** — one of `console | ledger | tty`, selected by `?variant=`, default `console`. Persisted as `localStorage["zot.variant"]` and reflected as `#app[data-variant]`.
- **Build manifest** — `web/build.json`: module list, per-file digests, one `sourceHash`. The committed artifact the gate re-derives.
- **Operator console** — this visual family: dense dark chrome, mono for machine facts, state always labeled and color-coded, selected detail always visible in the inspector.
- **Bare React Native** — a community CLI RN app with a checked in ios project, not Expo.
- **Raw APNs token** — the 64 hex device token from didRegisterForRemoteNotificationsWithDeviceToken.
- **Tracer bullet** — the thinnest end to end path, pair to token to runs to stream, proven before UI polish.
- **Baked pair** — the automation only pairing flavor driven by launch args, hidden from normal users.
- **Human gate** — a check that needs the Mac or the iPhone and cannot run on the Linux build host.
