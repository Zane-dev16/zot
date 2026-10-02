# CHATOPS

`src/chatops.js` owns outbound webhooks and the inbound plan. Tests live in `scripts/verify-chatops.js`. Run `node --check src/chatops.js` and `node scripts/verify-chatops.js`.

## Setup

To send outbound traffic, set one env var per vendor. The keys are `CHATOPS_SLACK_WEBHOOK` and `CHATOPS_TELEGRAM_WEBHOOK` and `CHATOPS_DISCORD_WEBHOOK`. To accept inbound traffic, set `CHATOPS_INBOUND_SECRET` to a long random value. Keep the secret out of logs and the repo.

## Send outbound

Call `sendChatops` with a target and a message. The target is one of `slack` and `telegram` and `discord`. The message shape is `{ text, channel }`. When the webhook URL arg is empty, the call falls back to the env var for that target. When no URL is set, the call returns `{ ok: false, skipped: "webhook-not-configured" }` and sends nothing.

Use `buildPayload` to preview the vendor body without sending. Slack keeps `text` and `channel`. Telegram maps `channel` to `chat_id`. Discord sends `content`. Use `getWebhookUrl` to read the env URL for one target. Use `isOutboundConfigured` to test that read. Use `listTargets` to list the three vendors.

Tests never touch the network. Pass a stub as `fetchFn` in the options arg. The stub receives the URL and the JSON body. Assert on the body the stub received.

## Accept inbound

The planned route is `POST /api/v1/chatops/inbound`. The route is not wired yet. `api.js` will adopt `planInboundRoute` when it adds the handler. The client sends `{ target, text, channel, sender }`. The secret rides in the `x-chatops-secret` header. The handler inlines this order. It checks the secret first. It parses the body next. It enqueues the message last.

Use `checkInboundSecret` for the header comparison. It uses a timing safe compare. It returns false for empty input and for length mismatch. Use `parseInbound` to validate the body. It throws for an unknown target. It throws for missing text. Use `handleInbound` for the full step. It returns `401` for a bad secret. It returns `400` for a bad body. It returns `202` with the queued row for good input.

## Queue and log

The queue holds `ChatQueueItem` rows. Each row has `id` and `target` and `text` and `channel` and `status` and `createdAt`. `enqueueChatops` adds one row with status `queued`. `listQueue` returns a copy of the queue. `clearQueue` empties the queue and resets the counter.

The log holds `ChatLogEntry` rows. Each row has `id` and `direction` and `target` and `text` and `ok` and `status` and `at`. `logChatops` appends one row and caps the list at 200 rows. `listLog` returns a copy of the log. `clearLog` empties the log. Inbound success logs direction `in` with status `202`.
