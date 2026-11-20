# Quickstart

You will boot the daemon on your machine and send one prompt from the browser chat. You will approve one waiting run in Approvals and read its tool events in the inspector.

You need Node 22 or later and curl. No build step exists. No npm install is needed for the default path.

## Boot the daemon

Run this command from the repo root.

```sh
node src/daemon2.js
```

The daemon listens here.

```text
http://127.0.0.1:8787
```

Check health with this command.

```sh
curl http://127.0.0.1:8787/healthz
```

You will see JSON with ready state. The full check lives in `scripts/prove.sh`.

## Send one prompt

Open this address in a browser.

```text
http://127.0.0.1:8787/
```

There is no token field in the topbar. An unpaired browser boots on the Pairing view, where Pair this browser runs the code flow and confirms it in the same page, and the manual fallback under Enter a device token manually takes a token you already have. Either way the token goes to `localStorage`, never to the address bar. Type a prompt in the composer and press Send. The run appears in the live thread. The status chip shows live when the stream is connected, reconnecting with a retry count when the socket drops, and offline when it stops retrying. Press Retry now to retry at once.

## Approve one run

Open Approvals in the sidebar (`#/approvals`). A run that needs approval is a row in that queue: the run's own prompt line in mono, a short note, then the Approve and Cancel button row. Approve moves the run from waiting_tool to running, and a queued run approves straight to running. Cancel moves the run to cancelled. A bad transition returns 409. Chat, Activity, and the inspector never perform a transition; their rows link here.

## Read Activity

Activity lists the 30 newest runs. Each row shows title and state and update time. Select a row to open its tool events in the inspector. Activity has no Approve or Cancel buttons; runs that need a decision are in Approvals. Press Refresh to reload the list. The list refreshes on its own after you send a prompt. The count next to Activity shows how many rows are shown.

Poll one run events with the since id.

```sh
curl -H "Authorization: Bearer $ZOT_TOKEN" \
  "http://127.0.0.1:8787/api/v1/runs/<id>/events?since=0"
```

## Env vars

The daemon needs no env vars for the default path. Port defaults to 8787. Set `PORT` to change it.

Optional vars in this list.

```text
CHATOPS_INBOUND_SECRET guards POST /api/v1/chatops/inbound, see docs/CHATOPS.md
CHATOPS_SLACK_WEBHOOK plus CHATOPS_TELEGRAM_WEBHOOK plus CHATOPS_DISCORD_WEBHOOK set outbound targets, see docs/CHATOPS.md
CHATOPS_INTERVAL_MS sets the queue drain tick in ms, default 5000
OPENAI_API_KEY plus ANTHROPIC_API_KEY enable live models, see docs/MODELS.md
ZOT_OPENAI_MODEL plus ZOT_ANTHROPIC_MODEL plus ZOT_MODEL_TIMEOUT_MS tune live models
APNS_TEAM_ID plus APNS_KEY_ID plus APNS_KEY_PATH plus APNS_TOPIC plus APNS_MODE enable push, see docs/APNS.md
```

The Bearer token comes from pairing. Pair start returns a code. Pair confirm returns the token. Save it as `ZOT_TOKEN` for curl calls below. See `docs/API.md` for routes and `docs/SKILLS.md` for skill tools.

## Pair iOS on the LAN

Start the daemon on a host the phone can reach. Start pairing from the browser UI. Set Base URL in the Zot app to the host and port. Enter the six digit code within five minutes. Confirm saves the token in Keychain. Fetch runs and post new runs. See `docs/IOS.md` for the full flow and `docs/API.md` for routes.

LAN uses plain http for v0. Keep it on the home LAN. Revoke a lost device with DELETE on the device id.

## If the UI stays on connecting

Check that the daemon is still running. Check that the token is saved. Open healthz in the same browser. A 401 on runs means the token is wrong. A refused connection means the daemon port or host is wrong.
