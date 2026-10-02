/**
 * Reading and writing a tracker document on disk - data.json, or another
 * dataset beside it. server.js stores through this, and so does the
 * job-from-url importer when no server is running, so a change to how a save
 * is made (the backup, the temporary file, the check that it parses) reaches
 * both writers at once.
 *
 * A save never leaves a half-written file behind: the new bytes go to a
 * temporary file of their own, which is then renamed over the old one, after
 * the old one has been copied to <name>.bak.
 */

const crypto = require("crypto");
const fs = require("fs");
const { backupFor, tmpFor } = require("./paths.js");

/** What an empty tracker holds. */
const EMPTY = Object.freeze({ version: 1, savedAt: null, applications: Object.freeze([]) });
const emptyRaw = () => JSON.stringify(EMPTY, null, 2);

/* The ETag is a hash of the bytes on disk, so it survives a server restart and
   still notices a file someone edited behind our back. */
const etagOf = (/** @type {string} */ raw) =>
  '"' + crypto.createHash("sha1").update(raw).digest("hex").slice(0, 16) + '"';

/**
 * @param {typeof fs.promises} [fsp]  the filesystem; tests pass an in-memory one
 */
function createStore(fsp = fs.promises) {
  /**
   * The document and its ETag, or null when there is no file. With
   * `createIfMissing` a missing file is written empty first instead - how
   * data.json comes into being on first read. Throws when the file is not
   * valid JSON, so the failure is reported here rather than by the reader.
   *
   * @param {string} file
   * @param {{ createIfMissing?: boolean }} [opts]
   * @returns {Promise<{ raw: string, etag: string } | null>}
   */
  async function read(file, { createIfMissing = false } = {}) {
    try {
      const raw = await fsp.readFile(file, "utf8");
      JSON.parse(raw);
      return { raw, etag: etagOf(raw) };
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      if (!createIfMissing) return null;
      const raw = emptyRaw();
      await fsp.writeFile(file, raw);
      return { raw, etag: etagOf(raw) };
    }
  }

  /**
   * Replaces the file with `raw` and returns the new ETag. Refuses anything
   * that does not parse: nothing is persisted that the page cannot load again.
   *
   * @param {string} file
   * @param {string} raw
   * @returns {Promise<string>}
   */
  async function write(file, raw) {
    JSON.parse(raw);
    try {
      await fsp.copyFile(file, backupFor(file));
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    const tmp = tmpFor(file);
    try {
      await fsp.writeFile(tmp, raw);
      await fsp.rename(tmp, file);
    } catch (e) {
      await fsp.rm(tmp, { force: true });
      throw e;
    }
    return etagOf(raw);
  }

  return { read, write };
}

module.exports = { EMPTY, emptyRaw, etagOf, createStore };
