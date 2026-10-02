# TODO

Changes we want but haven't made yet. Newest first.

## Start/stop the server from the page

A button in the toolbar to stop `node src/server.js`, and to bring it back, so the
app doesn't need a terminal alongside it.

**The constraint.** Stopping is easy — the page is talking to the process it
wants to kill, so `POST /api/shutdown` plus a button is about 20 lines. Starting
is not: once the server is gone, nothing is listening on 8787, and a browser
cannot spawn a process. Any Start button needs a second thing that is still
alive when the server isn't. That choice is the whole design.

**Options, cheapest first.**

1. **Stop only.** `POST /api/shutdown` + a Stop button and a status pill. The
   page already probes `api/health` (`src/index.html:760`), so it can fall back to
   its localStorage mode and keep working. Restart stays a terminal command.
2. **Wrapper loop** *(recommended)*. A double-clickable `run.command` that
   re-runs the server; exit 75 means restart, exit 0 means stop. Gets us the
   button we'd actually use day to day — Restart, which re-reads `server.js`
   after an edit. Start-from-dead is still a double-click.
3. **Supervisor.** `runner.js` binds 8787, spawns `server.js` as a child and
   proxies to it. Start/Stop/Restart all work from the page and the page loads
   even when the backend is down. Costs an always-on process — which partly
   defeats "stop the server" — and proxying the SSE stream (`src/server.js:150`).
4. **URL-scheme helper.** An `app-trail://start` handler app, so even a dead page
   can launch the server with no daemon. macOS-only, and Chrome confirms each
   launch.

Option 2 doesn't foreclose option 3 — the page side is the same either way.

**Whichever we pick:** binding to `127.0.0.1` does not make `/api/shutdown`
private. Any page in the browser can POST to localhost, so require a custom
header (forcing a CORS preflight that cross-origin pages fail) and check
`Sec-Fetch-Site`.
