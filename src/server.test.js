/**
 * Unit tests for server.js's request handler, built with createApp() from an
 * in-memory filesystem, a stand-in for the page file, and a log the test can
 * read - no port is opened and nothing touches the real disk.
 *
 * What every route answers is the Playwright API suite's job, against a
 * running server. These cover what a running server cannot be made to show
 * from outside: a page file that fails to open, a page that disconnects in the
 * middle of being registered, and a machine without Notes.app.
 */

import { PassThrough, Readable, Writable } from "node:stream";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { createApp } from "./server.js";

const PORT = 8787;
const PATHS = { dir: "/d", data: "/d/data.json", jds: "/d/jds", config: "/d/config.json" };
const DOC = '{"version":1,"savedAt":null,"applications":[]}';

/** A response that keeps what was sent, and resolves `done` once it ends. */
class FakeResponse extends Writable {
  constructor(){
    super();
    this.status = 0;
    this.headers = {};
    this.body = "";
    this.headersSent = false;
    this.done = new Promise(resolve => this.on("finish", resolve));
  }
  writeHead(status, headers){
    Object.assign(this, { status, headers, headersSent: true });
    return this;
  }
  _write(chunk, encoding, callback){
    this.body += chunk;
    callback();
  }
}

function request(method, url, headers = {}){
  return Object.assign(Readable.from([]), { method, url, headers: { host: "localhost:" + PORT, ...headers } });
}

/** A filesystem holding data.json, and a log of what the server printed. */
function setup(overrides = {}){
  const fsys = createFsFromVolume(Volume.fromJSON({ [PATHS.data]: DOC }));
  const lines = [];
  const log = { log: line => lines.push(line), warn: () => {}, error: () => {} };
  const app = createApp({ paths: PATHS, port: PORT, fsp: /** @type {any} */ (fsys.promises), log, ...overrides });
  return { app, fsys, lines };
}

async function send(app, req){
  const res = new FakeResponse();
  await app.handle(/** @type {any} */ (req), /** @type {any} */ (res));
  await res.done;
  return res;
}

/** A page file that fails to open the way an unreadable one does. */
const unreadable = () => {
  const stream = new PassThrough();
  process.nextTick(() => stream.emit("error", Object.assign(new Error("permission denied"), { code: "EACCES" })));
  return /** @type {any} */ (stream);
};

describe("serving the page", () => {
  it("answers 500 when the page file cannot be opened", async () => {
    const { app } = setup({ openFile: unreadable });

    const res = await send(app, request("GET", "/"));

    expect([res.status, res.body]).toEqual([500, "Could not read index.html"]);
  });

  it("goes on answering after a page file it could not open", async () => {
    const { app } = setup({ openFile: unreadable });
    await send(app, request("GET", "/"));

    const res = await send(app, request("GET", "/api/health"));

    expect(res.status).toBe(200);
  });
});

describe("a page that disconnects from /api/events while it is being registered", () => {
  it("is not counted among the pages told of a change", async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const fsys = createFsFromVolume(Volume.fromJSON({ [PATHS.data]: DOC }));
    const fsp = /** @type {any} */ (fsys.promises);
    const slowReads = { ...fsp, readFile: async (...args) => { await gate; return fsp.readFile(...args); } };
    const { app, lines } = setup({ fsp: slowReads });
    const req = request("GET", "/api/events");
    const opened = app.handle(/** @type {any} */ (req), /** @type {any} */ (new FakeResponse()));
    req.emit("close");                         // gone while its first read is still waiting
    release();
    await opened;
    fsys.writeFileSync(PATHS.data, '{"applications":[{"id":"a1"}]}');

    await app.changedOnDisk();

    expect(lines).toEqual(["  data.json changed on disk  -> told 0 page(s)"]);
  });
});

describe("POST /api/note on a machine that cannot write to Notes.app", () => {
  it("answers 501 without running anything", async () => {
    const { app } = setup({ canWriteNotes: false, writeNote: () => { throw new Error("must not run"); } });
    const req = request("POST", "/api/note", { "content-type": "application/json" });

    const res = await send(app, req);

    expect([res.status, JSON.parse(res.body)]).toEqual([501, { ok: false, error: "Notes.app is macOS only." }]);
  });
});
