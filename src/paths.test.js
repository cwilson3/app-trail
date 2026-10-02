/**
 * Unit tests for paths.js - where the tracker keeps its data, and the one-time
 * copy of what older checkouts kept inside the repository.
 *
 * Nothing here touches the real disk: paths.js takes the filesystem as an
 * argument, and each test hands it a fresh in-memory one from memfs. Platform,
 * home folder and environment are passed in too, so the results are the same
 * on any machine. Whether server.js and the importer really end up on the same
 * folder is checked against a running server, not here.
 */

import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { copiedNotice, defaultDataDir, pathsIn, prepareDataDir, resolveDataPaths, tmpFor } from "./paths.js";

const ROOT = "/repo";
const HOME = "/home/u";
const DIR = "/home/u/.local/share/app-trail";   // the default for linux, which these tests use
const MARCH = new Date("2026-03-04T05:06:07Z");

/* What a checkout from before the move holds: the tracker and its companions
   under data/, plus config.json and jds/ at the top. */
const LEGACY = {
  "/repo/data/data.json": '{"applications":[{"id":"a1"}]}',
  "/repo/data/data.json.bak": '{"applications":[]}',
  "/repo/data/data.import.log.jsonl": '{"action":"create"}\n',
  "/repo/data/data.json.3fa9c1.tmp": "{",
  "/repo/data/data.sample.json": '{"applications":[]}',
  "/repo/config.json": '{"note":{"title":"Old"}}',
  "/repo/jds/acme-qa.md": "# Acme - QA"
};

/** @param {Record<string, string>} files */
function diskWith(files){
  const fsys = createFsFromVolume(Volume.fromJSON(files));
  if (fsys.existsSync("/repo/jds/acme-qa.md")) fsys.utimesSync("/repo/jds/acme-qa.md", MARCH, MARCH);
  return fsys;
}

/** @param {ReturnType<typeof diskWith>} fsys */
function prepare(fsys, env = {}){
  return prepareDataDir({ root: ROOT, env, platform: "linux", home: HOME, fsys });
}

describe("defaultDataDir", () => {
  it("uses Application Support on macOS", () => {
    expect(defaultDataDir({}, "darwin", HOME)).toBe("/home/u/Library/Application Support/app-trail");
  });

  it("uses APPDATA on Windows", () => {
    expect(defaultDataDir({ APPDATA: "/appdata" }, "win32", HOME)).toBe("/appdata/app-trail");
  });

  it("falls back to AppData/Roaming on Windows when APPDATA is unset", () => {
    expect(defaultDataDir({}, "win32", HOME)).toBe("/home/u/AppData/Roaming/app-trail");
  });

  it("uses XDG_DATA_HOME on Linux", () => {
    expect(defaultDataDir({ XDG_DATA_HOME: "/xdg" }, "linux", HOME)).toBe("/xdg/app-trail");
  });

  it("falls back to ~/.local/share on Linux when XDG_DATA_HOME is unset", () => {
    expect(defaultDataDir({}, "linux", HOME)).toBe(DIR);
  });
});

describe("pathsIn", () => {
  it("keeps data.json, its backup, config.json, jds/ and the import log in the one folder", () => {
    expect(pathsIn("/d")).toEqual({
      dir: "/d",
      data: "/d/data.json",
      backup: "/d/data.json.bak",
      config: "/d/config.json",
      jds: "/d/jds",
      importLog: "/d/data.import.log.jsonl"
    });
  });
});

describe("prepareDataDir on a fresh install", () => {
  it("creates the data folder", () => {
    const fsys = diskWith({ "/repo/index.html": "" });

    prepare(fsys);

    expect(fsys.existsSync(DIR)).toBe(true);
  });

  it("has nothing to copy", () => {
    const fsys = diskWith({ "/repo/index.html": "" });

    const prepared = prepare(fsys);

    expect(prepared.copied).toEqual([]);
  });
});

describe("prepareDataDir with APP_TRAIL_DATA_DIR set", () => {
  it("uses that folder", () => {
    const fsys = diskWith(LEGACY);

    const prepared = prepare(fsys, { APP_TRAIL_DATA_DIR: "/scratch/run" });

    expect(prepared.data).toBe("/scratch/run/data.json");
  });

  it("never seeds it with the tracker still in the repository", () => {
    const fsys = diskWith(LEGACY);

    prepare(fsys, { APP_TRAIL_DATA_DIR: "/scratch/run" });

    expect(fsys.existsSync("/scratch/run/data.json")).toBe(false);
  });
});

describe("prepareDataDir upgrading a checkout that kept data in the repository", () => {
  it("reports each thing it copied", () => {
    const fsys = diskWith(LEGACY);

    const prepared = prepare(fsys);

    expect(prepared.copied).toEqual([
      "data/data.import.log.jsonl",
      "data/data.json",
      "data/data.json.bak",
      "config.json",
      "jds"
    ]);
  });

  it("copies the tracker unchanged", () => {
    const fsys = diskWith(LEGACY);

    prepare(fsys);

    expect(fsys.readFileSync(DIR + "/data.json", "utf8")).toBe('{"applications":[{"id":"a1"}]}');
  });

  it("copies the saved job descriptions", () => {
    const fsys = diskWith(LEGACY);

    prepare(fsys);

    expect(fsys.readFileSync(DIR + "/jds/acme-qa.md", "utf8")).toBe("# Acme - QA");
  });

  it("keeps a job description's modification time", () => {
    const fsys = diskWith(LEGACY);

    prepare(fsys);

    expect(fsys.statSync(DIR + "/jds/acme-qa.md").mtime.toISOString()).toBe(MARCH.toISOString());
  });

  it("skips a half-written .tmp save", () => {
    const fsys = diskWith(LEGACY);

    prepare(fsys);

    expect(fsys.existsSync(DIR + "/data.json.3fa9c1.tmp")).toBe(false);
  });

  it("skips data.sample.json, which ships in examples/ instead", () => {
    const fsys = diskWith(LEGACY);

    prepare(fsys);

    expect(fsys.existsSync(DIR + "/data.sample.json")).toBe(false);
  });

  it("leaves the original files in the repository", () => {
    const fsys = diskWith(LEGACY);

    prepare(fsys);

    expect(fsys.existsSync("/repo/data/data.json")).toBe(true);
  });

  it("copies nothing once the folder already holds a data.json", () => {
    const fsys = diskWith({ ...LEGACY, [DIR + "/data.json"]: '{"applications":[]}' });

    const prepared = prepare(fsys);

    expect(prepared.copied).toEqual([]);
  });

  it("never replaces a file already in the folder", () => {
    const fsys = diskWith({ ...LEGACY, [DIR + "/config.json"]: '{"note":{"title":"New"}}' });

    prepare(fsys);

    expect(fsys.readFileSync(DIR + "/config.json", "utf8")).toBe('{"note":{"title":"New"}}');
  });
});

describe("copiedNotice", () => {
  it("is null when nothing was copied", () => {
    expect(copiedNotice({ dir: DIR, copied: [] })).toBeNull();
  });

  it("names what was copied and where it went", () => {
    expect(copiedNotice({ dir: DIR, copied: ["data/data.json", "jds"] })).toBe(
      "Copied data/data.json, jds from the repository into " + DIR +
      ". That folder is where AppTrail keeps your data now; the copies left in the repository are no longer used."
    );
  });
});

describe("tmpFor", () => {
  it("names the temporary file after the dataset it will replace", () => {
    expect(tmpFor("/d/data.json")).toMatch(/^\/d\/data\.json\.[0-9a-f]{12}\.tmp$/);
  });

  it("never gives two saves the same temporary file", () => {
    expect(tmpFor("/d/data.json")).not.toBe(tmpFor("/d/data.json"));
  });
});

describe("resolveDataPaths", () => {
  it("takes everything else from beside a data.json passed with --data", () => {
    expect(resolveDataPaths({ data: "/elsewhere/mine.json" })).toEqual({
      dir: "/elsewhere",
      data: "/elsewhere/mine.json",
      backup: "/elsewhere/mine.json.bak",
      config: "/elsewhere/config.json",
      jds: "/elsewhere/jds",
      importLog: "/elsewhere/data.import.log.jsonl"
    });
  });

  it("prepares the data folder when no data.json is passed", () => {
    const prepared = Object.assign(pathsIn(DIR), { copied: [] });

    expect(resolveDataPaths({ prepare: () => prepared, log: () => {} })).toBe(prepared);
  });

  it("reports what preparing the data folder copied", () => {
    const lines = [];

    resolveDataPaths({ prepare: () => Object.assign(pathsIn(DIR), { copied: ["jds"] }), log: line => lines.push(line) });

    expect(lines).toEqual(["\n  " + copiedNotice({ dir: DIR, copied: ["jds"] })]);
  });
});
