# zot

Local first daemon plus browser chat for personal automation.

Vision. One process on localhost owns state. Browser chat talks to it over HTTP. No cloud dependency for v0.

Quickstart.

1. Run `node daemon.js`.
2. Expect `zot heartbeat` on stdout.
3. Run `node src/server.js` in a second terminal.
4. Open `http://localhost:3000/health` and expect `ok`.
5. Open `web/index.html` in a browser for the chat placeholder.
