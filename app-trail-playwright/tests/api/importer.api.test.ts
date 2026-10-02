import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import { test, expect } from "../../fixtures/api.fixture";
import type { TrackerDocument } from "../../models/tracker";
import { IMPORTER } from "../../utils/appRepo";
import { BACKUP, MAIN_DATASET, TestDocs, dataStore } from "../../utils/dataDir";

/* The job-from-url importer, apply.js, run against the server under test: it
   finds the server through /api/health and writes data.json through it. Every
   test starts with HOMESTAR as data.json (the mainDataset fixture). */

const IMPORT_LOG = "data.import.log.jsonl";
const ROW = (JSON.parse(TestDocs.HOMESTAR) as TrackerDocument).applications[0];

/** What extract.js would hand apply.js for this row's own posting. */
const ENVELOPE = {
  url: ROW.jobLink,
  method: "test",
  fields: { company: ROW.company, roleTitle: ROW.roleTitle, industry: "Food Service" },
  trusted: { jobLink: ROW.jobLink, systemOfRecord: ROW.systemOfRecord },
};

let workDir: string;

async function runImporter(port: string, dataFile: string, ...extra: string[]): Promise<void> {
  const envelope = path.join(workDir, "envelope.json");
  fs.writeFileSync(envelope, JSON.stringify(ENVELOPE));
  await promisify(execFile)("node", [IMPORTER, "--envelope", envelope, "--id", ROW.id,
    "--port", port, "--data", dataFile, ...extra]);
}

test.beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "app-trail-importer-"));
  dataStore.remove(IMPORT_LOG);
});

test.afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
  dataStore.remove(IMPORT_LOG);
});

test.describe("apply.js re-importing a posting the row already holds", { tag: ["@endpoint:PUT:/data/{name}"] }, () => {
  test("writes nothing: data.json, its backup and the import log are left alone", async ({ baseURL }) => {
    const port = new URL(baseURL!).port;

    await runImporter(port, dataStore.pathOf(MAIN_DATASET));

    expect(dataStore.read(MAIN_DATASET)).toBe(TestDocs.HOMESTAR);
    expect(dataStore.exists(BACKUP)).toBe(false);
    expect(dataStore.exists(IMPORT_LOG)).toBe(false);
  });
});

test.describe("apply.js with --overwrite", { tag: ["@endpoint:PUT:/data/{name}"] }, () => {
  test("saves the changed field through the server, keeping the previous version as the backup", async ({ baseURL }) => {
    const port = new URL(baseURL!).port;

    await runImporter(port, dataStore.pathOf(MAIN_DATASET), "--overwrite");

    const saved = JSON.parse(dataStore.read(MAIN_DATASET)) as TrackerDocument;
    expect(saved.applications[0].industry).toBe("Food Service");
    expect(dataStore.read(BACKUP)).toBe(TestDocs.HOMESTAR);
  });
});

/* A data.json no running server serves: apply.js writes the file itself, the
   way server.js would - the previous version kept as a backup beside it. */
test.describe("apply.js with no server for its data.json", () => {
  test("writes the file directly, keeping the previous version as the backup", async ({ baseURL }) => {
    const port = new URL(baseURL!).port;
    const dataFile = path.join(workDir, "data.json");
    fs.writeFileSync(dataFile, TestDocs.HOMESTAR);

    await runImporter(port, dataFile, "--overwrite");

    const saved = JSON.parse(fs.readFileSync(dataFile, "utf8")) as TrackerDocument;
    expect(saved.applications[0].industry).toBe("Food Service");
    expect(fs.readFileSync(`${dataFile}.bak`, "utf8")).toBe(TestDocs.HOMESTAR);
    expect(dataStore.read(MAIN_DATASET)).toBe(TestDocs.HOMESTAR);
  });
});
