/**
 * Unit tests for browser.js: which saved sign-in a URL gets, when a run is
 * taken to have been sent to a sign-in page, and that a failing step still
 * closes the browser. The CLI is replaced by a recorder - it is the boundary
 * to a real browser - so nothing here starts one.
 */

import { describe, expect, it } from "vitest";
import { authFor, landedOnSignIn, render } from "./browser.js";

const saved = () => true;
const unsaved = () => false;

/** A CLI that keeps every command it is given and fails the one named `failing`. */
function cliFailing(failing){
  const commands = [];
  const run = args => {
    commands.push(args[0]);
    return args[0] === failing ? { ok: false, error: "net::ERR_NAME_NOT_RESOLVED" } : { ok: true };
  };
  return { commands, run };
}

/* The error `fn` throws. A run that does not fail is itself a failure here,
   so this throws in its place rather than returning nothing. */
function errorFrom(fn){
  try { fn(); } catch (e) { return e; }
  throw new Error("expected render to fail, and it did not");
}

describe("authFor", () => {
  it("picks the LinkedIn sign-in for a LinkedIn posting", () => {
    expect(authFor(new URL("https://www.linkedin.com/jobs/view/123"), saved))
      .toMatchObject({ board: "LinkedIn", script: "auth:linkedin", file: expect.stringMatching(/\.auth\/linkedin\.json$/) });
  });

  it("picks the Ladders sign-in for a Ladders posting", () => {
    expect(authFor(new URL("https://www.theladders.com/job/engineer-acme_123"), saved))
      .toMatchObject({ board: "TheLadders", script: "auth:ladders", file: expect.stringMatching(/\.auth\/ladders\.json$/) });
  });

  it("says when the board's sign-in has not been saved yet", () => {
    expect(authFor(new URL("https://www.linkedin.com/jobs/view/123"), unsaved).saved).toBe(false);
  });

  it("has no sign-in for a company's own careers page", () => {
    expect(authFor(new URL("https://acme.com/careers/123"), saved)).toBeNull();
  });

  it("does not hand LinkedIn's sign-in to a host that only ends in its name", () => {
    expect(authFor(new URL("https://notlinkedin.com/jobs/view/123"), saved)).toBeNull();
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

    const error = errorFrom(() => render(url, { workDir: "/unused", run, exists: saved }));

    expect(error.message).toBe("loading the page failed: net::ERR_NAME_NOT_RESOLVED");
  });

  it("closes the browser when a step fails", () => {
    const { commands, run } = cliFailing("goto");

    errorFrom(() => render(url, { workDir: "/unused", run, exists: saved }));

    expect(commands.at(-1)).toBe("close");
  });

  it("loads the saved sign-in before it opens the posting", () => {
    const { commands, run } = cliFailing("goto");

    errorFrom(() => render(url, { workDir: "/unused", run, exists: saved }));

    expect(commands.slice(0, 3)).toEqual(["open", "state-load", "goto"]);
  });

  it("opens the posting signed out when no sign-in has been saved", () => {
    const { commands, run } = cliFailing("goto");

    errorFrom(() => render(url, { workDir: "/unused", run, exists: unsaved }));

    expect(commands.slice(0, 2)).toEqual(["open", "goto"]);
  });
});
