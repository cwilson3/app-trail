/**
 * Where AppTrail keeps your data - the tracker, its backup, the import log,
 * config.json and the saved job descriptions. One answer, shared by server.js
 * and the job-from-url scripts, because the importer only writes through a
 * running server that reports the same data.json it would have written itself.
 *
 * The folder is outside the repository, so none of it can be committed by
 * accident, `git clean` cannot delete it, and every clone or worktree sees the
 * same tracker:
 *
 *   macOS    ~/Library/Application Support/app-trail
 *   Windows  %APPDATA%\app-trail
 *   other    $XDG_DATA_HOME/app-trail, else ~/.local/share/app-trail
 *
 * APP_TRAIL_DATA_DIR overrides it - the Playwright suite points it at a scratch
 * folder, and it is how to keep the tracker somewhere synced, such as Dropbox.
 */

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const DATA_NAME = "data.json";
/* This file sits in src/, one level below the top of the repository - the
   root an older checkout's data/, config.json and jds/ are found under. */
const REPO_ROOT = path.join(__dirname, "..");

/* Beside every dataset: one backup of the version a save replaced, and while a
   save is under way, a temporary file with a name of its own. A shared name
   belongs to whichever rename lands first, leaving the other writer renaming a
   file that is already gone. */
const backupFor = (/** @type {string} */ file) => file + ".bak";
const tmpFor = (/** @type {string} */ file) => file + "." + crypto.randomBytes(6).toString("hex") + ".tmp";
const isTmp = (/** @type {string} */ name) => name.endsWith(".tmp");

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [platform]
 * @param {string} [home]
 */
function defaultDataDir(env = process.env, platform = process.platform, home = os.homedir()) {
  if (platform === "darwin") return path.join(home, "Library", "Application Support", "app-trail");
  if (platform === "win32") return path.join(env.APPDATA || path.join(home, "AppData", "Roaming"), "app-trail");
  return path.join(env.XDG_DATA_HOME || path.join(home, ".local", "share"), "app-trail");
}

/**
 * Every path the app reads or writes, for a given data folder.
 * @param {string} dir
 */
function pathsIn(dir) {
  const data = path.join(dir, DATA_NAME);
  return {
    dir,
    data,
    backup: backupFor(data),
    config: path.join(dir, "config.json"),
    jds: path.join(dir, "jds"),
    importLog: path.join(dir, "data.import.log.jsonl")
  };
}

/**
 * Until this module existed everything lived in the repository - data/ for
 * the tracker, config.json and jds/ at the top. The first time the default
 * folder is used it takes a copy of whatever is still there, so upgrading
 * loses nothing. It only copies: the old files are left where they were, and
 * a file already in the new folder is never replaced.
 *
 * @param {string} root  the repository
 * @param {string} dir   the new data folder
 * @param {typeof fs} [fsys]  the filesystem; tests pass an in-memory one
 * @returns {string[]}   what was copied, relative to root
 */
function copyLegacyData(root, dir, fsys = fs) {
  const target = pathsIn(dir);
  if (fsys.existsSync(target.data)) return [];
  const copied = [];
  const copy = (/** @type {string} */ rel, /** @type {string} */ dest) => {
    const src = path.join(root, rel);
    if (!fsys.existsSync(src) || fsys.existsSync(dest)) return;
    copyTree(fsys, src, dest);
    copied.push(rel);
  };

  const legacyData = path.join(root, "data");
  if (fsys.existsSync(legacyData) && fsys.statSync(legacyData).isDirectory()) {
    for (const name of fsys.readdirSync(legacyData).map(String).sort()) {
      /* half-written saves are not data; data.sample.json now ships in examples/ */
      if (isTmp(name) || name === "data.sample.json") continue;
      if (fsys.statSync(path.join(legacyData, name)).isFile()) copy(path.join("data", name), path.join(dir, name));
    }
  }
  copy(path.basename(target.config), target.config);
  copy(path.basename(target.jds), target.jds);
  return copied;
}

/* A file, or a folder and everything in it, keeping modification times so a
   job description saved in March still says March. */
function copyTree(/** @type {typeof fs} */ fsys, /** @type {string} */ src, /** @type {string} */ dest) {
  const stat = fsys.statSync(src);
  if (stat.isDirectory()) {
    fsys.mkdirSync(dest, { recursive: true });
    for (const name of fsys.readdirSync(src).map(String)) copyTree(fsys, path.join(src, name), path.join(dest, name));
  } else {
    fsys.copyFileSync(src, dest);
  }
  fsys.utimesSync(dest, stat.atime, stat.mtime);
}

/**
 * Resolve the data folder, make sure it exists, and on first use of the
 * default folder bring over what an older checkout kept in the repository.
 * An APP_TRAIL_DATA_DIR folder is taken as given - a test run must never be
 * seeded with someone's real tracker.
 *
 * @param {{ root?: string, env?: NodeJS.ProcessEnv, platform?: string, home?: string, fsys?: typeof fs }} [opts]
 */
function prepareDataDir({ root = REPO_ROOT, env = process.env, platform = process.platform, home = os.homedir(), fsys = fs } = {}) {
  const override = env.APP_TRAIL_DATA_DIR;
  const dir = override ? path.resolve(override) : defaultDataDir(env, platform, home);
  fsys.mkdirSync(dir, { recursive: true });
  const copied = override ? [] : copyLegacyData(root, dir, fsys);
  return Object.assign(pathsIn(dir), { copied });
}

/**
 * The line to print when prepareDataDir copied something, or null.
 * @param {{ dir: string, copied: string[] }} prepared
 */
function copiedNotice(prepared) {
  if (!prepared.copied.length) return null;
  return "Copied " + prepared.copied.join(", ") + " from the repository into " + prepared.dir +
    ". That folder is where AppTrail keeps your data now; the copies left in the repository are no longer used.";
}

/**
 * The paths a job-from-url script works with. `data` names a data.json of the
 * caller's choosing (--data), and everything else is taken from beside it;
 * without one, the data folder is prepared as server.js prepares it, and
 * anything copied into it is reported through `log`.
 *
 * @param {{ data?: string | null, log?: (line: string) => void, prepare?: typeof prepareDataDir }} [opts]
 */
function resolveDataPaths({ data = null, log = console.log, prepare = prepareDataDir } = {}) {
  if (data) {
    const file = path.resolve(data);
    return Object.assign(pathsIn(path.dirname(file)), { data: file, backup: backupFor(file) });
  }
  const prepared = prepare();
  const notice = copiedNotice(prepared);
  if (notice) log("\n  " + notice);
  return prepared;
}

module.exports = {
  DATA_NAME, backupFor, tmpFor, isTmp,
  defaultDataDir, pathsIn, copyLegacyData, prepareDataDir, copiedNotice, resolveDataPaths
};
