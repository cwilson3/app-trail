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
 * The sessions themselves come from app-trail-playwright's setup files
 * (`npm run auth:linkedin`, `npm run auth:ladders`), which save the browser's
 * storage state after you sign in by hand.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { systemOfRecord } = require("./lib.js");

const PLAYWRIGHT_DIR = path.resolve(__dirname, "..", "..", "..", "..", "app-trail-playwright");
const PLAYWRIGHT_BIN = path.join(PLAYWRIGHT_DIR, "node_modules", ".bin", "playwright");

/* The boards with a saved sign-in, keyed by systemOfRecord, which comes from
   the URL the user typed and never from the page. `file` is a copy of
   AuthStates in app-trail-playwright/constants/authStates.ts, and `script`
   is the package.json script that writes it. If you change them there,
   change them here. */
const AUTH_DIR = path.join(PLAYWRIGHT_DIR, "playwright", ".auth");
const AUTH = {
  LinkedIn:   { file: path.join(AUTH_DIR, "linkedin.json"), script: "auth:linkedin" },
  TheLadders: { file: path.join(AUTH_DIR, "ladders.json"),  script: "auth:ladders" }
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
 * The saved sign-in for the board `url` is on, or null when there is none.
 * `exists` says whether its file has been written yet.
 *
 * @param {URL} url
 * @param {(file: string) => boolean} [exists]
 */
function authFor(url, exists = fs.existsSync){
  const board = systemOfRecord(url);
  const auth = AUTH[board];
  return auth ? { board, file: auth.file, script: auth.script, saved: exists(auth.file) } : null;
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
 *           exists?: (file: string) => boolean }} opts
 *   workDir holds the rendered page and the snapshots the CLI writes - your
 *   scratchpad, never the repository. run replaces the CLI, for tests.
 * @returns {{ body: string, description: string, finalUrl: string, auth: object|null,
 *             signedOut: boolean }}
 */
function render(url, opts){
  const timeout = opts.timeout || 30000;
  const run = opts.run || cliRunner("job-from-url-" + process.pid, opts.workDir, timeout);
  if (!opts.run && !fs.existsSync(PLAYWRIGHT_BIN)) {
    throw new Error("Playwright is not installed. Run npm install in " + PLAYWRIGHT_DIR);
  }

  const auth = authFor(url, opts.exists);
  const pageFile = path.join(opts.workDir, "browser-page.json");
  const step = (name, args) => {
    const res = run(args);
    if (!res.ok) throw new Error(name + " failed: " + res.error);
  };

  try {
    step("opening the browser", ["open"]);
    if (auth && auth.saved) step("loading the saved sign-in", ["state-load", auth.file]);
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

module.exports = { authFor, landedOnSignIn, render, DESCRIPTION_SELECTORS };
