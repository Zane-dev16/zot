# Quickstart

You will boot the daemon on your machine and send one prompt from the browser chat. You will approve one waiting run and find its tool events in Activity.

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

Save the device token in the top field. Type a prompt in the composer and press Send. The run appears in the live log. The status line shows live when the stream is connected. It shows reconnecting with a retry count when the socket drops. Press Retry now to retry at once.

## Approve one run

A run that needs approval shows a highlighted card. The card names the waiting tool. It shows Approve and Cancel buttons. Approve moves the run from waiting_tool to running. Cancel moves the run to cancelled. A bad transition returns 409. The button labels name the tool when the tool is known.

## Read Activity

Activity lists the 30 newest runs. Each row shows title and state and update time. Press a row to load its tool events. A run in waiting_tool also shows an Approve button in Activity. Press Refresh to reload the list. The list refreshes on its own after you send a prompt. The count next to Activity shows how many rows are shown.

Poll one run events with the since id.

```sh
curl -H "Authorization: Bearer $ZOT_TOKEN" \
  "http://127.0.0.1:8787/api/v1/runs/<id>/events?since=0"
```

## Pair iOS on the LAN

Start the daemon on a host the phone can reach. Start pairing from the browser UI. Set Base URL in the Zot app to the host and port. Enter the six digit code within five minutes. Confirm saves the token in Keychain. Fetch runs and post new runs. See `docs/IOS.md` for the full flow and `docs/API.md` for routes.

LAN uses plain http for v0. Keep it on the home LAN. Revoke a lost device with DELETE on the device id.

## If the UI stays on connecting

Check that the daemon is still running. Check that the token is saved. Open healthz in the same browser. A 401 on runs means the token is wrong. A refused connection means the daemon port or host is wrong.
