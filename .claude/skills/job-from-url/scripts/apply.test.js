/**
 * Unit tests for how apply.js reads and writes data.json through a running
 * tracker: the save must carry the ETag of the copy it read, so the server can
 * refuse it if the open page saved in between.
 *
 * fetch is stubbed - it is the boundary to the server - and every case here
 * goes through the server, so nothing touches the disk. The importer against a
 * real server is covered by the Playwright suite.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { blankApp, ensureRoleId, load, sameLink, save } from "./apply.js";

const ORIGIN = "http://127.0.0.1:8787";
const DATA_PATH = "/nowhere/data.json";     // never read: every case has a server
const ETAG = '"3fa9c1d2e4b5a687"';
const DOC = { version: 1, savedAt: null, applications: [{ id: "a1", company: "Acme" }] };

/** Answers every request with `response`, keeping what was asked. */
function serverAnswering(response){
  const requests = [];
  vi.stubGlobal("fetch", async (url, init = {}) => {
    requests.push({ url, method: init.method || "GET", headers: init.headers || {} });
    return response();
  });
  return requests;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("load through a running tracker", () => {
  it("returns the document with the ETag the server sent", async () => {
    serverAnswering(() => new Response(JSON.stringify(DOC), { status: 200, headers: { ETag: ETAG } }));

    const loaded = await load(DATA_PATH, ORIGIN);

    expect(loaded).toEqual({ data: DOC, etag: ETAG });
  });

  it("fails when the server cannot hand over data.json, instead of reading the file", async () => {
    serverAnswering(() => new Response("data/data.json could not be read", { status: 500 }));

    await expect(load(DATA_PATH, ORIGIN)).rejects.toThrow("could not read data.json: HTTP 500");
  });

  it("fails when the server sends data.json without an ETag", async () => {
    serverAnswering(() => new Response(JSON.stringify(DOC), { status: 200 }));

    await expect(load(DATA_PATH, ORIGIN)).rejects.toThrow("without an ETag");
  });
});

describe("save through a running tracker", () => {
  it("sends the ETag of the copy it read as If-Match", async () => {
    const requests = serverAnswering(() => new Response('{"ok":true}', { status: 200 }));

    await save(structuredClone(DOC), DATA_PATH, ORIGIN, ETAG);

    expect(requests.map(r => [r.method, r.headers["If-Match"]])).toEqual([["PUT", ETAG]]);
  });

  it("refuses to save without an ETag", async () => {
    serverAnswering(() => new Response('{"ok":true}', { status: 200 }));

    await expect(save(structuredClone(DOC), DATA_PATH, ORIGIN, null)).rejects.toThrow("without the ETag");
  });

  it("sends nothing to the server when it has no ETag", async () => {
    const requests = serverAnswering(() => new Response('{"ok":true}', { status: 200 }));

    await save(structuredClone(DOC), DATA_PATH, ORIGIN, null).catch(() => {});

    expect(requests).toEqual([]);
  });
});

describe("sameLink", () => {
  const LINK = "https://acme.com/careers/123?team=eng&loc=ny";

  it("matches a link that differs only in host case and a leading www.", () => {
    expect(sameLink("https://www.Acme.com/careers/123?team=eng&loc=ny", LINK)).toBe(true);
  });

  it("matches a link that differs only in a trailing slash and the query order", () => {
    expect(sameLink("https://acme.com/careers/123/?loc=ny&team=eng", LINK)).toBe(true);
  });

  it("does not match a different posting on the same host", () => {
    expect(sameLink("https://acme.com/careers/124?team=eng&loc=ny", LINK)).toBe(false);
  });

  it("does not match a different query value", () => {
    expect(sameLink("https://acme.com/careers/123?team=ops&loc=ny", LINK)).toBe(false);
  });
});

/* blankApp() has to stay in step with the one in index.html: a row the importer
   writes and a row the + button writes are read back by the same page. */
describe("the row the importer starts from", () => {
  it("is born with a role id", () => {
    expect(blankApp(1).roleId).toMatch(/^[0-9a-z]+$/);
  });

  it("gets a role id of its own, not the one the row before it got", () => {
    expect(blankApp(1).roleId).not.toBe(blankApp(2).roleId);
  });
});

describe("a row the importer is about to update", () => {
  it("is given a role id when it was written before role ids existed", () => {
    expect(ensureRoleId({ id: "a1", company: "Acme" }).roleId).toMatch(/^[0-9a-z]+$/);
  });

  it("keeps the role id it already carries", () => {
    expect(ensureRoleId({ id: "a1", roleId: "smr10001" }).roleId).toBe("smr10001");
  });
});
