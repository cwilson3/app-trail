# app-trail-playwright

API and E2E tests for AppTrail, written with Playwright. Self-contained (own
`package.json`, own `node_modules`) so it can be lifted into its own repository.

```sh
npm install
npx playwright install chromium firefox webkit
npm test               # everything
npm run test:api       # *.api.test.ts
npm run test:e2e       # *.e2e.test.ts, in Chrome, Firefox and WebKit
npm run test:pageload  # *.pageload.test.ts
npm run report         # open the last HTML report
npm run typecheck      # tsc over the specs and their helpers
```

Playwright starts the server on port 8788 (override with `APP_TRAIL_PORT`)
and stops it when the run ends. It sets `APP_TRAIL_DATA_DIR` so the server keeps
its data in `.test-run/` rather than your real data folder. That folder is wiped at the
start of every run, and every test starts from the same data folder: the
Homestar dataset as `data.json`, and no `config.json`, `jds/` or recorded notes
(the automatic fixtures in `fixtures/api.fixture.ts`).

Nothing here assumes where the app lives. By default it is the repository this
folder sits in; once the suite is in a repository of its own, point it at the
app with:

| Variable | Default | What it names |
| -------- | ------- | ------------- |
| `APP_TRAIL_ROOT` | `..` | A checkout of the app: its server, spec and importer |
| `APP_TRAIL_SERVER_CMD` | `node $APP_TRAIL_ROOT/src/server.js` | The command that starts the server; the port is appended |
| `APP_TRAIL_SPEC` | `$APP_TRAIL_ROOT/spec.yml` | The OpenAPI contract responses are checked against |
| `APP_TRAIL_DATA_DIR` | `.test-run/` | The server's data folder, which tests arrange through the `DataStore` in `utils/dataDir.ts` |

`.test-data/` holds the committed datasets tests start from (`TestDocs` in
`utils/dataDir.ts`). The server never writes there:

| File | Contents |
| ---- | -------- |
| `test-data-1.fellowship.json` | 25 applications (The Hobbit / The Lord of the Rings). Uses every status, round type, round status, round result and contact type at least once |
| `test-data-2.homestar.json` | 13 applications (Homestar Runner), one per status. Shares no companies or IDs with dataset 1, so swapping one for the other is easy to detect |

## API tests and spec.yml

The API tests check every response against `spec.yml`, the server's OpenAPI
contract. `expect(response).toMatchSpec()` fails a test when the status code,
content type, body, or a required header is not what the spec documents for
the operation the response answered - `AppTrailService` records the method and
spec path on every response - so a test cannot pass by locking in behaviour
the spec does not describe. `toMatchComponent(name)` checks an answer against
one of the spec's shared responses. `methods.api.test.ts` checks that
`constants/routes.ts` lists exactly the spec's paths, then walks every path and
checks the 405 for a method it does not take.

| Folder | Holds |
| ------ | ----- |
| `constants/` | Routes (and the spec's spelling of each path), request limits, and the server's exact message text |
| `models/` | Request and response types |
| `services/` | `AppTrailService` - one typed method per operation |
| `fixtures/` | `appTrailApi`, `openEventStream`, `newDatasetName`, and the automatic `mainDataset`, `configFile`, `jobDescriptions` and `noteSink` - each cleaned up after the test - plus the `toMatchSpec` and `toMatchComponent` matchers |
| `utils/` | Where the app is, the data folder, spec validation, the server-sent event reader, setup helpers |

Each describe carries an `@endpoint:<METHOD>:<spec path>` tag, so
`npx playwright test --grep "@endpoint:PUT:/data/{name}"` runs one operation.

`POST /api/note` never reaches Notes.app. The server is started with
`APP_TRAIL_NOTE_COMMAND` pointing at `support/fake-osascript.js`, which is called
exactly as osascript would be and records each note under `.test-run/note-sink/`
instead. The `noteSink` fixture reads what was written and can make the next
call fail, which is how the 403 and 500 responses are reached. What this does
not test is the AppleScript itself; the 501 a server answers off macOS when no
stand-in is set is covered by the app's own `server.test.js`.
