/**
 * Unit tests for browser.js: which board profile a URL gets, when a profile
 * is taken to be open in another browser, when a run is taken to have been
 * sent to a sign-in page, and that a failing step still closes the browser.
 * The CLI is replaced by a recorder - it is the boundary to a real browser -
 * and the environment, the folders and the running processes are passed in,
 * so nothing here starts a browser or reads the machine.
 */

import path from "node:path";
import { describe, expect, it } from "vitest";
import { authFor, landedOnSignIn, loadEnvFile, profileInUse, render } from "./browser.js";

const PROFILES = { APP_TRAIL_LINKEDIN_PROFILE: "/profiles/linkedin", APP_TRAIL_LADDERS_PROFILE: "/profiles/ladders" };
const saved = { env: PROFILES, exists: () => true, inUse: () => false };
const unsaved = { env: PROFILES, exists: () => false, inUse: () => false };

/** A CLI that keeps every command it is given and fails the one named `failing`. */
function cliFailing(failing){
  const commands = [];
  const run = args => {
    commands.push(args[0]);
    return args[0] === failing ? { ok: false, error: "net::ERR_NAME_NOT_RESOLVED" } : { ok: true };
  };
  return { commands, run };
}

/* A CLI that keeps every command line it is given and fails at goto, so a
   render stops before it would read a page file. */
function cliRecording(){
  const calls = [];
  const run = args => {
    calls.push(args);
    return args[0] === "goto" ? { ok: false, error: "stopped here" } : { ok: true };
  };
  return { calls, run };
}

/* The error `fn` throws. A call that does not fail is itself a failure here,
   so this throws in its place rather than returning nothing. */
function errorFrom(fn){
  try { fn(); } catch (e) { return e; }
  throw new Error("expected the call to fail, and it did not");
}

describe("authFor", () => {
  it("opens a LinkedIn posting on the profile APP_TRAIL_LINKEDIN_PROFILE names, headless", () => {
    expect(authFor(new URL("https://www.linkedin.com/jobs/view/123"), saved))
      .toEqual({ board: "LinkedIn", env: "APP_TRAIL_LINKEDIN_PROFILE", profile: "/profiles/linkedin", headed: false, saved: true });
  });

  it("opens a Ladders posting on the profile APP_TRAIL_LADDERS_PROFILE names, in a window", () => {
    expect(authFor(new URL("https://www.theladders.com/job/engineer-acme_123"), saved))
      .toEqual({ board: "TheLadders", env: "APP_TRAIL_LADDERS_PROFILE", profile: "/profiles/ladders", headed: true, saved: true });
  });

  it("has no profile to open when the board's variable is unset", () => {
    const auth = authFor(new URL("https://www.linkedin.com/jobs/view/123"), { env: {}, exists: () => true });

    expect(auth).toMatchObject({ profile: null, saved: false });
  });

  it("says when the profile the variable names does not exist", () => {
    expect(authFor(new URL("https://www.linkedin.com/jobs/view/123"), unsaved).saved).toBe(false);
  });

  it("has no sign-in for a company's own careers page", () => {
    expect(authFor(new URL("https://acme.com/careers/123"), saved)).toBeNull();
  });

  it("does not hand LinkedIn's profile to a host that only ends in its name", () => {
    expect(authFor(new URL("https://notlinkedin.com/jobs/view/123"), saved)).toBeNull();
  });
});

/* Read from .env.test beside this file, never the repository's .env, which
   holds this machine's real profile paths. */
describe("loadEnvFile", () => {
  const ENV_TEST = path.join(import.meta.dirname, ".env.test");

  it("sets each variable .env.test names", () => {
    const env = {};

    loadEnvFile(ENV_TEST, env);

    expect(env).toEqual({
      APP_TRAIL_LINKEDIN_PROFILE: "/profiles/linkedin from env test",
      APP_TRAIL_LADDERS_PROFILE: "/profiles/ladders-from-env-test"
    });
  });

  it("leaves a variable the environment already sets", () => {
    const env = { APP_TRAIL_LINKEDIN_PROFILE: "/profiles/from-the-shell" };

    loadEnvFile(ENV_TEST, env);

    expect(env.APP_TRAIL_LINKEDIN_PROFILE).toBe("/profiles/from-the-shell");
  });

  it("sets nothing when the file is not there", () => {
    const env = {};

    loadEnvFile(path.join(import.meta.dirname, ".env.missing"), env);

    expect(env).toEqual({});
  });

  /* A folder is a path that exists but cannot be read as a file: a real
     read error other than "not there", on every platform and for every user. */
  it("raises a read error other than the file not being there, setting nothing", () => {
    const env = {};

    const error = errorFrom(() => loadEnvFile(import.meta.dirname, env));

    expect(error).toMatchObject({ code: "EISDIR" });
    expect(env).toEqual({});
  });
});

describe("profileInUse", () => {
  const PROFILE = "/Users/me/Library/Application Support/profiles/linkedin";
  const running = (...lines) => () => lines;

  it("is open when a running browser has it as its user data dir", () => {
    const lines = running("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=" + PROFILE + " --headless");

    expect(profileInUse(PROFILE, "darwin", lines)).toBe(true);
  });

  it("is not open when only a profile whose name starts the same is", () => {
    expect(profileInUse(PROFILE, "darwin", running("chrome --user-data-dir=" + PROFILE + "-old"))).toBe(false);
  });

  it("is not open when no browser has it", () => {
    expect(profileInUse(PROFILE, "darwin", running("node src/server.js"))).toBe(false);
  });

  it("is never taken for open on Windows, which has no ps to ask", () => {
    expect(profileInUse(PROFILE, "win32", running("chrome --user-data-dir=" + PROFILE))).toBe(false);
  });
});

describe("landedOnSignIn", () => {
  it("recognises LinkedIn's authwall", () => {
    expect(landedOnSignIn("https://www.linkedin.com/authwall?trk=job")).toBe(true);
  });

  it("recognises a login page", () => {
    expect(landedOnSignIn("https://www.theladders.com/login")).toBe(true);
  });

  it("takes a posting whose path merely starts with 'login' for a posting", () => {
    expect(landedOnSignIn("https://acme.com/loginservices-engineer")).toBe(false);
  });

  it("takes an address it cannot parse for a posting", () => {
    expect(landedOnSignIn("not a url")).toBe(false);
  });
});

describe("render", () => {
  const url = new URL("https://www.linkedin.com/jobs/view/123");

  it("names the step that failed", () => {
    const { run } = cliFailing("goto");

    const error = errorFrom(() => render(url, { workDir: "/unused", run, ...saved }));

    expect(error.message).toBe("loading the page failed: net::ERR_NAME_NOT_RESOLVED");
  });

  it("closes the browser when a step fails", () => {
    const { commands, run } = cliFailing("goto");

    errorFrom(() => render(url, { workDir: "/unused", run, ...saved }));

    expect(commands.at(-1)).toBe("close");
  });

  it("opens the browser on the board's profile", () => {
    const { calls, run } = cliRecording();

    errorFrom(() => render(url, { workDir: "/unused", run, ...saved }));

    expect(calls[0]).toEqual(["open", "--profile=/profiles/linkedin"]);
  });

  it("opens Ladders' profile in a window", () => {
    const { calls, run } = cliRecording();

    errorFrom(() => render(new URL("https://www.theladders.com/job/engineer-acme_123"), { workDir: "/unused", run, ...saved }));

    expect(calls[0]).toEqual(["open", "--profile=/profiles/ladders", "--headed"]);
  });

  it("opens the posting signed out when the profile does not exist", () => {
    const { calls, run } = cliRecording();

    errorFrom(() => render(url, { workDir: "/unused", run, ...unsaved }));

    expect(calls[0]).toEqual(["open"]);
  });

  it("refuses, without opening a browser, when another browser has the profile open", () => {
    const { calls, run } = cliRecording();

    const error = errorFrom(() => render(url, { workDir: "/unused", run, ...saved, inUse: () => true }));

    expect(error.message).toBe("another browser has the LinkedIn profile open (/profiles/linkedin); close that window and run this again");
    expect(calls).toEqual([]);
  });
});
