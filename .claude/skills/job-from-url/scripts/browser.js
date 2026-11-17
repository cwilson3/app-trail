/**
 * The browser path for extract.js. It renders one posting in a headless
 * browser through the Playwright CLI, signed in when a saved session exists
 * for that board, for pages a plain fetch cannot read: postings rendered by
 * JavaScript, and boards like LinkedIn that show signed-out visitors only part
 * of the description.
 *
 *   extract.js <url> --browser --out envelope.json
 *
 * The CLI prints the page's title and an accessibility snapshot after each
 * step. That is page content, and the agent that runs extract.js must not see
 * page content, so none of the CLI's output is passed on. The rendered page
 * goes to a file, read only by extract.js. The only thing reported is which
 * step failed, if one does.
 *
 * A board's sign-in is a browser profile, named by an environment variable
 * (PROFILES below) and opened with the CLI's --profile. The profile belongs
 * to whatever signs in to the board and reads it - on this machine,
 * AppTrail Backpack, whose `npm run auth` signs in to it - so a board has one
 * sign-in and one expiry. AppTrail only opens it. The variables can be set
 * in the environment or in a git-ignored .env at the top of the repository
 * (loadEnvFile); the environment wins.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { parseEnv } = require("util");
const { systemOfRecord } = require("./lib.js");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const PLAYWRIGHT_DIR = path.join(REPO_ROOT, "app-trail-playwright");
/* This machine's settings for the scripts, such as where each board's
   browser profile is. Git-ignored: the paths are this machine's own. */
const ENV_FILE = path.join(REPO_ROOT, ".env");
const PLAYWRIGHT_BIN = path.join(PLAYWRIGHT_DIR, "node_modules", ".bin", "playwright");

/* The boards a sign-in can be read signed in to, keyed by systemOfRecord,
   which comes from the URL the user typed and never from the page. `env`
   names the variable holding the board's browser profile; unset, the board
   is read signed out. Ladders sits behind Cloudflare, which stops a headless
   browser, so its page is read in a window. */
const PROFILES = {
  LinkedIn:   { env: "APP_TRAIL_LINKEDIN_PROFILE", headed: false },
  TheLadders: { env: "APP_TRAIL_LADDERS_PROFILE",  headed: true }
};

/* The element that holds the posting on a signed-in page, per board. When one
   matches, its markup becomes the description, so the file jd.js writes holds
   only the job and not the site's navigation. A board missing here, or a
   selector that no longer matches after a redesign, falls back to the whole
   page. */
const DESCRIPTION_SELECTORS = {
  LinkedIn: ["#job-details", ".jobs-description__content"]
};

/* Where a board sends a visitor whose session has expired or never existed.
   Matched against the path the browser ended up on, which the page can choose,
   so all this ever changes is the warning printed to the user. */
const SIGN_IN_PATH = /^\/(authwall|login|signin|sign-in|checkpoint|uas\/login)(\/|$)/i;

/**
 * Copies the .env file's values into env, leaving any already set alone. A
 * missing file is no settings, not an error.
 *
 * @param {string} [file]
 * @param {NodeJS.ProcessEnv} [env]
 * @param {(file: string) => string} [readFile]
 */
function loadEnvFile(file = ENV_FILE, env = process.env, readFile = f => fs.readFileSync(f, "utf8")){
  let text;
  try { text = readFile(file); }
  catch (e) {
    if (e.code === "ENOENT") return;
    throw e;
  }
  for (const [key, value] of Object.entries(parseEnv(text))) {
    if (env[key] === undefined) env[key] = value;
  }
}

/**
 * The sign-in for the board `url` is on, or null when the board has none.
 * `profile` is the folder its variable names, or null when it is unset;
 * `saved` says whether that folder exists to be opened.
 *
 * @param {URL} url
 * @param {{ env?: NodeJS.ProcessEnv, exists?: (dir: string) => boolean }} [opts]
 */
function authFor(url, { env = process.env, exists = fs.existsSync } = {}){
  const board = systemOfRecord(url);
  const known = PROFILES[board];
  if (!known) return null;
  const profile = env[known.env] ? path.resolve(env[known.env]) : null;
  return { board, env: known.env, profile, headed: known.headed, saved: !!profile && exists(profile) };
}

/* The command line of every running process, one per line. */
function processCommandLines(){
  const res = spawnSync("ps", ["-Ao", "args="], { encoding: "utf8" });
  return res.status === 0 ? res.stdout.split("\n") : [];
}

/**
 * Whether a running browser has `dir` open as its profile. A profile can be
 * open in one browser at a time - two write the same cookie files under each
 * other - and Chrome under Playwright leaves no lock file, so the running
 * processes are asked: each of a browser's carries --user-data-dir=<dir>.
 * The same check AppTrail Backpack makes before it opens a board's profile.
 * Windows has no `ps`, and there the answer is always no.
 *
 * @param {string} dir
 * @param {string} [platform]
 * @param {() => string[]} [commandLines]
 */
function profileInUse(dir, platform = process.platform, commandLines = processCommandLines){
  if (platform === "win32") return false;
  const flag = "--user-data-dir=" + path.resolve(dir);
  return commandLines().some(line => {
    const at = line.indexOf(flag);
    if (at < 0) return false;
    const next = line[at + flag.length];
    return next === undefined || /\s/.test(next);
  });
}

/** Did the browser end up on a sign-in page instead of the posting? */
function landedOnSignIn(finalUrl){
  try { return SIGN_IN_PATH.test(new URL(finalUrl).pathname); }
  catch (e) { return false; }
}

/* The function the page runs. The selectors are written into its source as
   JSON, because eval takes the function as a string. */
function readPageSource(selectors){
  return "() => {" +
    " const el = " + JSON.stringify(selectors || []) +
    ".map(s => document.querySelector(s)).find(Boolean);" +
    " return { url: location.href, html: document.documentElement.outerHTML," +
    " description: el ? el.innerHTML : '' };" +
    " }";
}

/* Runs one CLI command. Only the "### Error" line of a failure is returned,
   and only the part Playwright wrote: the rest of the output is the page. */
function cliRunner(session, cwd, timeout){
  return args => {
    const res = spawnSync(PLAYWRIGHT_BIN, ["cli", "-s=" + session].concat(args), {
      cwd, encoding: "utf8", timeout, stdio: ["ignore", "pipe", "pipe"]
    });
    if (res.error) return { ok: false, error: String(res.error.message || res.error) };
    if (res.status === 0) return { ok: true };
    const out = String(res.stdout || "") + String(res.stderr || "");
    const m = out.match(/^### Error\n\w*Error: ([^\n]{0,200})/m);
    return { ok: false, error: m ? m[1] : "exit " + res.status };
  };
}

/**
 * Renders `url` and returns the page as extract.js reads a fetched one, plus
 * the posting's own element when the board has a selector for it.
 *
 * The browser is always closed, even when a step fails, so a run never leaves
 * a headless browser behind.
 *
 * @param {URL} url
 * @param {{ workDir: string, timeout?: number, run?: (args: string[]) => {ok: boolean, error?: string},
 *           env?: NodeJS.ProcessEnv, exists?: (dir: string) => boolean, inUse?: (dir: string) => boolean }} opts
 *   workDir holds the rendered page and the snapshots the CLI writes - your
 *   scratchpad, never the repository. run replaces the CLI, and env, exists
 *   and inUse the machine, for tests.
 * @returns {{ body: string, description: string, finalUrl: string, auth: object|null,
 *             signedOut: boolean }}
 */
function render(url, opts){
  const timeout = opts.timeout || 30000;
  const run = opts.run || cliRunner("job-from-url-" + process.pid, opts.workDir, timeout);
  if (!opts.run && !fs.existsSync(PLAYWRIGHT_BIN)) {
    throw new Error("Playwright is not installed. Run npm install in " + PLAYWRIGHT_DIR);
  }

  const auth = authFor(url, { env: opts.env, exists: opts.exists });
  const signedIn = !!(auth && auth.saved);
  if (signedIn && (opts.inUse || profileInUse)(auth.profile)) {
    throw new Error("another browser has the " + auth.board + " profile open (" + auth.profile + "); close that window and run this again");
  }
  const pageFile = path.join(opts.workDir, "browser-page.json");
  const step = (name, args) => {
    const res = run(args);
    if (!res.ok) throw new Error(name + " failed: " + res.error);
  };

  try {
    step("opening the browser", signedIn
      ? ["open", "--profile=" + auth.profile].concat(auth.headed ? ["--headed"] : [])
      : ["open"]);
    step("loading the page", ["goto", url.href]);
    /* goto returns at DOMContentLoaded; give a script-built page a moment to
       fill in, without failing a page that never goes quiet. */
    run(["run-code", "async page => { await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {}); }"]);
    step("reading the page", ["eval", readPageSource(DESCRIPTION_SELECTORS[auth ? auth.board : ""]),
                              "--filename=" + pageFile]);
  } finally {
    run(["close"]);
  }

  const page = JSON.parse(fs.readFileSync(pageFile, "utf8"));
  fs.unlinkSync(pageFile);
  const finalUrl = typeof page.url === "string" ? page.url : url.href;
  return {
    body: typeof page.html === "string" ? page.html : "",
    description: typeof page.description === "string" ? page.description : "",
    finalUrl,
    auth,
    signedOut: landedOnSignIn(finalUrl)
  };
}

module.exports = { authFor, landedOnSignIn, loadEnvFile, profileInUse, render, DESCRIPTION_SELECTORS };
