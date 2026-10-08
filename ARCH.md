# Architecture

How AppTrail is put together, and why the pieces are split the way they are.
For what the app does and how to run it, see the [README](README.md).

## The shape of it

One HTML file is the whole app. `src/index.html` carries the markup, the
styles and every bit of logic the browser runs — there is no build step and no
runtime dependency. `src/server.js` is a zero-dependency Node process that
serves that page and owns the data file beside it.

The split that matters is not page/server, though. It is this: **two separate
writers can change `data.json`, and neither can see the other.** The open page
is one. The `/job-from-url` importer is the other. Everything below follows
from that.

## Where the data lives

`src/paths.js` is the single answer to "which folder?", and it is deliberately
outside the repository — `~/Library/Application Support/app-trail` on macOS,
`%APPDATA%\app-trail` on Windows, `$XDG_DATA_HOME` elsewhere, or whatever
`APP_TRAIL_DATA_DIR` names.

Keeping it out of the checkout means none of it can be committed by accident,
`git clean` cannot delete it, and every clone or worktree sees the same
tracker. Both the server and the importer ask `paths.js`, so they cannot
disagree about which file they are fighting over.

## How a write is made safe

Three mechanisms stack up, each covering a failure the one below it cannot.

**On disk — `src/store.js`.** A save never leaves a half-written file. The new
bytes go to a temporary file with a random name, the old file is copied to
`<name>.bak`, then the temporary file is renamed over the original. The rename
is the atomic step. Writes are refused unless they parse as JSON, so nothing is
persisted that the page cannot load again. The server and the importer both
save through this module, so a change to how a save is made reaches both at
once.

**Between writers — the ETag.** The ETag is a SHA-1 of the bytes on disk, not a
server-side counter, so it survives a restart and still notices a file edited
behind the server's back. `PUT /data/data.json` must carry `If-Match`; a stale
one is refused with **409 plus the current document**, so the loser of a race
can merge rather than overwrite. `If-Match: *` forces the write through.

**Between overlapping saves — the write lock.** A save is read-the-ETag-then-
replace, which only guards anything if nothing slips in between. Interleaved,
two writers both match the same ETag and the second silently wins. `createApp()`
funnels every save through a promise queue so each takes its turn.

## How the page keeps up

A file can change without the page doing anything — the importer writes, or you
edit `data.json` by hand. So `server.js` watches the data folder and broadcasts
one `change` event per write on `GET /api/events` (server-sent events). It
compares against the last ETag it broadcast to skip the echo of its own writes.

The page folds an incoming version into its own rather than replacing it.
`mergeRemote()` keeps any row the user has touched — and keeps its object
identity, so an open detail card goes on writing to the row it was opened on —
and takes everything else from disk. Rows deleted locally stay deleted; rows
added locally and not yet saved are carried over.

If the cursor is in a field, the merge is **deferred**: rebuilding the card
underneath someone mid-keystroke loses the keystroke and the caret. The held
version waits in `pendingRemote`, and critically the page's `serverEtag` waits
with it — sending a save with an ETag you have not actually merged would claim
to have seen a version you have not.

## Four places the data can go

`STORES` in `index.html` holds one entry per mode, so adding somewhere else to
keep the tracker is a new entry rather than another branch in every function
that asks where the data went.

| Mode | When | Where a save goes |
| --- | --- | --- |
| `server` | `server.js` answered at boot | `PUT /data/data.json` with `If-Match` |
| `fs` | A file linked through the File System Access API | That file handle |
| `local` | No server, no handle | The browser copy only |
| `dataset` | A separate file opened with **Import** | Nowhere until **Save**, which asks first |

Every mode writes a copy into `localStorage` first, whatever happens to the
save that follows, so a failed write never costs you the edit.

## The route table is the contract

`src/routes.js` lists every route and the methods each takes. It is not
documentation — `bindRoutes()` refuses to start the server if a route has no
handler, or a handler belongs to no route. `spec.yml` documents the same list
as OpenAPI 3.1, and `routes.test.js` fails the moment the two disagree. A new
endpoint is a row in `routes.js`, a handler in `server.js` and an entry in
`spec.yml`, or nothing runs.

Anything matching no route can only be the page itself, and is 404 otherwise.
`STATIC_FILES` is exactly three entries — the page and the one script it loads
— so `.git/`, `node_modules` and the rest of the checkout stay private. The
server listens on 127.0.0.1 only.

## Two agreements the code enforces rather than documents

**The job-description filename.** `src/jd-name.js` derives `jds/<company>-<role>.md`
from a row. The name is derived and never stored, so `data.json` carries no
path — which means the page and the importer must derive it identically. They
do it by loading the same file: `index.html` as a `<script>` the server serves
beside it, the importer through `require()`.

**What an import may change.** `apply.js` validates against an allow-list, so a
key it does not recognise is a rejection rather than a passthrough. That is
what stops "also set status to Offer" from being something a job posting can
do. `jobLink` and `systemOfRecord` never come from the candidate at all — the
first is the address you typed, the second is derived from it — so neither can
be redirected by the page being read.

## Testing

Unit tests are Vitest, co-located beside the code they cover, run with
`npm test`. `src/test-support/loadIndexApp.js` parses `index.html` into a fresh
jsdom window per test and runs its scripts in document order, with a stand-in
for `server.js` answering `fetch` — which is how the single-file page is
testable at unit scope at all. API and end-to-end tests are Playwright and live
in `app-trail-playwright/`, a separate suite.

## Files

| File | What it is |
| --- | --- |
| `src/index.html` | The whole app — markup, styles, and logic |
| `src/server.js` | Small static server + the `data.json` read/write endpoint. `createApp()` builds the request handler; running the file listens |
| `src/routes.js` | Every route the server answers, and the methods each takes — the table `spec.yml` documents |
| `src/store.js` | Reading and writing a tracker file: the ETag, the backup, the temporary file renamed into place. The server and the importer both save through it |
| `src/note.js` | The Note button's server side: the table's limits, the note's HTML, and running `osascript` |
| `src/paths.js` | Where the data folder is, and the one-time copy out of older checkouts |
| `spec.yml` | The server's HTTP contract (OpenAPI 3.1) |
| `examples/data.sample.json` | Three example applications; import it (**Actions → Import**) to see the app populated |
| `config.example.json` | A starting `config.json` — copy it into your data folder to choose the note **Note** writes to |
| `src/jd-name.js` | How a job description's file is named — loaded by the page and by `/job-from-url`, so both agree |
| `src/*.test.js` | Unit tests (`npm test`), each beside the code it covers; `src/test-support/` holds the page loader they share |
| `package.json` | Test tooling only — the app itself still has no dependencies |
| `.claude/skills/job-from-url/` | The `/job-from-url` skill — adds an application from a posting's URL |
| `.claude/agents/job-extract.md` | The sandboxed reader that skill uses |
