#!/usr/bin/env node
/**
 * Start the app on one of the Playwright suite's test datasets, without going
 * near your real tracker:
 *
 *   npm run demo:fellowship    -> 25 applications
 *   npm run demo:homestar      -> 13 applications
 *   npm run demo -- homestar 9000   -> on another port
 *
 * Each run copies the dataset fresh into .demo-data/<name>/ and points the
 * server there with APP_TRAIL_DATA_DIR, so edits made while poking around are
 * thrown away next time. It listens on 8789 - not 8787, where your own
 * tracker runs, nor 8788, the Playwright suite's - so all three can be up at
 * once. Note writes to a note of its own, "AppTrail demo (<name>)", rather
 * than the one your real tracker keeps.
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const TEST_DATA = path.join(ROOT, "app-trail-playwright", ".test-data");
const DATASETS = {
  fellowship: "test-data-1.fellowship.json",
  homestar: "test-data-2.homestar.json"
};
const DEFAULT_PORT = 8789;

const [name, port = String(DEFAULT_PORT)] = process.argv.slice(2);
if (!Object.hasOwn(DATASETS, name)) {
  console.error("Usage: npm run demo -- <" + Object.keys(DATASETS).join("|") + "> [port]");
  process.exit(2);
}

const dir = path.join(ROOT, ".demo-data", name);
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
fs.copyFileSync(path.join(TEST_DATA, DATASETS[name]), path.join(dir, "data.json"));
fs.writeFileSync(path.join(dir, "config.json"),
  JSON.stringify({ note: { title: "AppTrail demo (" + name + ")", folder: "" } }, null, 2) + "\n");

const server = spawn(process.execPath, [path.join(ROOT, "src", "server.js"), port], {
  stdio: "inherit",
  env: Object.assign({}, process.env, { APP_TRAIL_DATA_DIR: dir })
});
server.on("exit", code => process.exit(code ?? 0));
