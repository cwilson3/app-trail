import { defineConfig, devices } from "@playwright/test";
import { Routes } from "./constants/routes";
import { SERVER_COMMAND } from "./utils/appRepo";
import { DATA_DIR } from "./utils/dataDir";
import { FAKE_OSASCRIPT, NOTE_SINK_DIR } from "./utils/noteSink";

// Port 8788, not the app's default 8787, so a test run never attaches to the
// tracker you have open day to day.
const PORT = Number(process.env.APP_TRAIL_PORT) || 8788;
const BASE_URL = `http://localhost:${PORT}`;

// The server keeps its data in DATA_DIR (.test-run/) instead of your real data
// folder, so tests never touch the real tracker. Wiped before each run; every
// test then starts from the Homestar dataset as data.json (the mainDataset
// fixture), and arranges anything else it needs.

export default defineConfig({
  // Projects match on the file name, not the folder: name a test *.api.test.ts,
  // *.e2e.test.ts or *.pageload.test.ts. Any other name is in no project and never runs.
  testDir: "./tests",
  fullyParallel: false, // Current implementation: the server writes one shared data file
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Current implementation: the server writes one shared data file
  reporter: process.env.CI
    ? [['dot'], ['github']]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: process.env.CI ? "on-first-retry" : "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "api", testMatch: "**/*.api.test.ts" },
    { name: "e2e-chrome", testMatch: "**/*.e2e.test.ts", use: { ...devices["Desktop Chrome"] } },
    { name: "e2e-firefox", testMatch: "**/*.e2e.test.ts", use: { ...devices["Desktop Firefox"] } },
    { name: "e2e-webkit", testMatch: "**/*.e2e.test.ts", use: { ...devices["Desktop Safari"] } },
    { name: "pageload", testMatch: "**/*.pageload.test.ts", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: `node -e "require('fs').rmSync(process.argv[1], { recursive: true, force: true })" "${DATA_DIR}" && ${SERVER_COMMAND} ${PORT}`,
    // POST /api/note runs the stand-in, never osascript: no real note is written.
    env: { APP_TRAIL_DATA_DIR: DATA_DIR, APP_TRAIL_NOTE_COMMAND: FAKE_OSASCRIPT, APP_TRAIL_NOTE_SINK: NOTE_SINK_DIR },
    url: `${BASE_URL}${Routes.HEALTH}`,
    reuseExistingServer: false,
    timeout: 10_000,
  },
});
