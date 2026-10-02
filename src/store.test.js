/**
 * Unit tests for store.js - how a tracker document is read from and written to
 * disk by both server.js and the importer.
 *
 * Nothing here touches the real disk: the store takes the filesystem as an
 * argument, and each test hands it a fresh in-memory one from memfs. Saving
 * through a running server is the Playwright suite's job.
 */

import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { createStore, emptyRaw, etagOf } from "./store.js";

const FILE = "/d/data.json";
const OLD = '{"applications":[{"id":"a1"}]}';
const NEW = '{"applications":[{"id":"b2"}]}';

/** @param {Record<string, string>} files */
function diskWith(files){
  const fsys = createFsFromVolume(Volume.fromJSON(files, "/"));
  fsys.mkdirSync("/d", { recursive: true });
  return { fsys, store: createStore(/** @type {any} */ (fsys.promises)) };
}

describe("read", () => {
  it("returns the bytes on disk with their ETag", async () => {
    const { store } = diskWith({ [FILE]: OLD });

    expect(await store.read(FILE)).toEqual({ raw: OLD, etag: etagOf(OLD) });
  });

  it("returns null for a file that is not there", async () => {
    const { store } = diskWith({});

    expect(await store.read(FILE)).toBeNull();
  });

  it("writes an empty tracker for a missing file when asked to create it", async () => {
    const { fsys, store } = diskWith({});

    await store.read(FILE, { createIfMissing: true });

    expect(fsys.readFileSync(FILE, "utf8")).toBe(emptyRaw());
  });

  it("throws for a file that is not valid JSON", async () => {
    const { store } = diskWith({ [FILE]: "{ not json" });

    await expect(store.read(FILE)).rejects.toThrow(SyntaxError);
  });
});

describe("write", () => {
  it("replaces the file", async () => {
    const { fsys, store } = diskWith({ [FILE]: OLD });

    await store.write(FILE, NEW);

    expect(fsys.readFileSync(FILE, "utf8")).toBe(NEW);
  });

  it("returns the ETag a read of the new file reports", async () => {
    const { store } = diskWith({ [FILE]: OLD });

    const etag = await store.write(FILE, NEW);

    expect(etag).toBe((await store.read(FILE)).etag);
  });

  it("keeps the version it replaced as <name>.bak", async () => {
    const { fsys, store } = diskWith({ [FILE]: OLD });

    await store.write(FILE, NEW);

    expect(fsys.readFileSync(FILE + ".bak", "utf8")).toBe(OLD);
  });

  it("creates a file that was not there, with no backup", async () => {
    const { fsys, store } = diskWith({});

    await store.write(FILE, NEW);

    expect(fsys.readdirSync("/d")).toEqual(["data.json"]);
  });

  it("refuses a body that is not valid JSON, leaving the file and its backup alone", async () => {
    const { fsys, store } = diskWith({ [FILE]: OLD });

    await store.write(FILE, "{ not json").catch(() => {});

    expect(fsys.readdirSync("/d")).toEqual(["data.json"]);
  });

  it("leaves no temporary file behind when the rename fails", async () => {
    const { fsys } = diskWith({ [FILE]: OLD });
    const fsp = /** @type {any} */ (fsys.promises);
    const store = createStore({ ...fsp, rename: async () => { throw new Error("disk full"); } });

    await store.write(FILE, NEW).catch(() => {});

    expect(fsys.readdirSync("/d").sort()).toEqual(["data.json", "data.json.bak"]);
  });
});
