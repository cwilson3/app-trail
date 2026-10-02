import { randomUUID } from "crypto";
import { test as base, expect as baseExpect } from "@playwright/test";
import { Routes } from "../constants/routes";
import type { ApiResponse } from "../models/responses";
import { AppTrailService } from "../services/AppTrailService";
import { BACKUP, MAIN_DATASET, TestDocs, dataStore } from "../utils/dataDir";
import { replaceDataset } from "../utils/datasetHelpers";
import { EventStream } from "../utils/eventStream";
import {
  type NextNoteResult, type RecordedNote, clearNoteSink, recordedNotes, setNextNoteResult,
} from "../utils/noteSink";
import { componentProblems, specProblems } from "../utils/spec";

const CONFIG_FILE = "config.json";

type ApiFixtures = {
  appTrailApi: AppTrailService;
  /** Opens /api/events. Every stream opened is closed when the test ends, pass or fail. */
  openEventStream: () => Promise<EventStream>;
  /** A unique name for a dataset other than data.json. Whatever it names is deleted when the test ends. */
  newDatasetName: () => string;
  /**
   * data.json as every test starts with it: the Homestar dataset, written
   * through the server so its idea of the current ETag is in step. Its backup
   * is removed when the test ends.
   */
  mainDataset: { name: string; raw: string; etag: string };
  /** config.json in the data folder. Absent at the start of every test, and removed after it. */
  configFile: { write(raw: string): void; writeNote(title: string, folder: string): void };
  /** jds/ in the data folder. Absent at the start of every test, and removed after it. */
  jobDescriptions: { write(name: string, text: string): void };
  /** The notes the stand-in for osascript recorded. Empty at the start of every test, and cleared after it. */
  noteSink: { recorded(): RecordedNote[]; failNext(result: NextNoteResult): void };
};

/* The fixtures that reset the data folder are automatic: every test starts
   from the same folder whether it asks for them or not, so no test depends on
   what the one before it left behind. */
export const test = base.extend<ApiFixtures>({
  appTrailApi: async ({ request }, use) => {
    await use(new AppTrailService(request));
  },
  openEventStream: async ({ baseURL }, use) => {
    const streams: EventStream[] = [];
    await use(async () => {
      const stream = await EventStream.open(new URL(Routes.EVENTS, baseURL).href);
      streams.push(stream);
      return stream;
    });
    for (const stream of streams) stream.close();
  },
  newDatasetName: async ({}, use) => {
    const names: string[] = [];
    await use(() => {
      const name = `dataset-${randomUUID()}.json`;
      names.push(name);
      return name;
    });
    for (const name of names) {
      dataStore.remove(name);
      dataStore.remove(`${name}.bak`);
    }
  },
  mainDataset: [async ({ appTrailApi }, use) => {
    const etag = await replaceDataset(appTrailApi, MAIN_DATASET, TestDocs.HOMESTAR);
    dataStore.remove(BACKUP);
    await use({ name: MAIN_DATASET, raw: TestDocs.HOMESTAR, etag });
    dataStore.remove(BACKUP);
  }, { auto: true }],
  configFile: [async ({}, use) => {
    dataStore.remove(CONFIG_FILE);
    await use({
      write: raw => dataStore.write(CONFIG_FILE, raw),
      writeNote: (title, folder) => dataStore.write(CONFIG_FILE, JSON.stringify({ note: { title, folder } })),
    });
    dataStore.remove(CONFIG_FILE);
  }, { auto: true }],
  jobDescriptions: [async ({}, use) => {
    dataStore.removeJobDescriptions();
    await use({ write: (name, text) => dataStore.writeJobDescription(name, text) });
    dataStore.removeJobDescriptions();
  }, { auto: true }],
  noteSink: [async ({}, use) => {
    clearNoteSink();
    await use({ recorded: recordedNotes, failNext: setNextNoteResult });
    clearNoteSink();
  }, { auto: true }],
});

const report = (problems: string[]) => () => problems.length ? problems.join("\n") : "the response matches spec.yml";

export const expect = baseExpect.extend({
  /** The response is one spec.yml documents for the operation it answered. */
  toMatchSpec(response: ApiResponse<unknown>) {
    const problems = specProblems(response);
    return { pass: problems.length === 0, message: report(problems), name: "toMatchSpec" };
  },
  /** The response matches spec.yml's components/responses/<name>. */
  toMatchComponent(response: ApiResponse<unknown>, name: string) {
    const problems = componentProblems(response, name);
    return { pass: problems.length === 0, message: report(problems), name: "toMatchComponent" };
  },
});
