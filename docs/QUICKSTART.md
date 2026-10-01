# Quickstart

Install Node 22 or later. Install curl for checks. Clone the repo. Run npm free. No build step exists.

Boot the daemon with this command.

```sh
node src/daemon2.js
```

The daemon listens on this address.

```text
http://127.0.0.1:8787
```

Check health with this command.

```sh
curl http://127.0.0.1:8787/healthz
```

Expect ready state in JSON. See scripts prove for the full check.

Open the browser UI at this path.

```text
http://127.0.0.1:8787/
```

Save the device token in the top field. Post a prompt in the composer. Watch runs stream in live.

Pair iOS over LAN with these steps.

```text
Start the daemon on a LAN reachable host
Open the browser UI and start pairing
Set Base URL in the Zot app to the host and port
Enter the six digit code within five minutes
Confirm saves the token in Keychain
Fetch runs and post new runs
```

LAN uses plain http for v0. Keep it on the home LAN. Revoke lost devices with DELETE on devices id. See docs API for routes.
