import { test, expect } from "../../fixtures/api.fixture";
import { DatasetLimits } from "../../constants/limits";
import { ErrorMessages } from "../../constants/messages";
import { Routes } from "../../constants/routes";
import type { ConflictResponse, SavedResponse } from "../../models/responses";
import type { TrackerDocument } from "../../models/tracker";
import { BACKUP, MAIN_DATASET, TestDocs, dataStore } from "../../utils/dataDir";
import { currentEtag } from "../../utils/datasetHelpers";

const STALE_ETAG = '"0000000000000000"';
const { HOMESTAR, FELLOWSHIP } = TestDocs;
const FELLOWSHIP_DOC = JSON.parse(FELLOWSHIP) as TrackerDocument;
const HOMESTAR_DOC = JSON.parse(HOMESTAR) as TrackerDocument;

/* Every test starts with HOMESTAR as data.json (the mainDataset fixture). */

test.describe("GET /data/{name}", { tag: ["@endpoint:GET:/data/{name}"] }, () => {
  test("returns the dataset as stored, with an ETag", async ({ appTrailApi }) => {
    const response = await appTrailApi.getDataset<TrackerDocument>(MAIN_DATASET);

    expect(response.status).toBe(200);
    expect(response.data).toEqual(HOMESTAR_DOC);
    expect(response).toMatchSpec();
  });

  test("creates an empty data.json on first read", async ({ appTrailApi }) => {
    dataStore.remove(MAIN_DATASET);

    const response = await appTrailApi.getDataset<TrackerDocument>(MAIN_DATASET);

    expect(response.status).toBe(200);
    expect(response.data).toEqual(JSON.parse(TestDocs.EMPTY));
    expect(JSON.parse(dataStore.read(MAIN_DATASET))).toEqual(response.data);
    expect(response).toMatchSpec();
  });

  test("returns 404 for another dataset that does not exist, without creating it", async ({ appTrailApi, newDatasetName }) => {
    const name = newDatasetName();

    const response = await appTrailApi.getDataset<string>(name);

    expect(response.status).toBe(404);
    expect(response.data).toBe(ErrorMessages.NOT_FOUND);
    expect(dataStore.exists(name)).toBe(false);
    expect(response).toMatchSpec();
  });

  test("returns 404 for the backup file, even though it exists", async ({ appTrailApi }) => {
    dataStore.write(BACKUP, FELLOWSHIP);

    const response = await appTrailApi.getDataset<string>(BACKUP);

    expect(response.status).toBe(404);
    expect(response.data).toBe(ErrorMessages.NOT_FOUND);
    expect(response).toMatchSpec();
  });

  test("returns 500 when the file on disk is not valid JSON", async ({ appTrailApi }) => {
    dataStore.write(MAIN_DATASET, "{ not json");

    const response = await appTrailApi.getDataset<string>(MAIN_DATASET);

    expect(response.status).toBe(500);
    expect(response.data.startsWith(ErrorMessages.couldNotRead(Routes.dataset(MAIN_DATASET)))).toBe(true);
    expect(response).toMatchSpec();
  });
});

test.describe("PUT /data/{name}", { tag: ["@endpoint:PUT:/data/{name}"] }, () => {
  test("replaces the dataset when If-Match carries the current ETag", async ({ appTrailApi, mainDataset }) => {
    const response = await appTrailApi.putDataset<SavedResponse>(MAIN_DATASET, FELLOWSHIP, mainDataset.etag);

    expect(response.status).toBe(200);
    expect(response.data).toEqual({ ok: true, etag: response.headers["etag"] });
    expect(response.data.etag).not.toBe(mainDataset.etag);
    expect(dataStore.read(MAIN_DATASET)).toBe(FELLOWSHIP);
    expect(response).toMatchSpec();
  });

  test("returns the ETag the next read reports", async ({ appTrailApi, mainDataset }) => {
    const response = await appTrailApi.putDataset<SavedResponse>(MAIN_DATASET, FELLOWSHIP, mainDataset.etag);

    expect(response.status).toBe(200);
    expect(await currentEtag(appTrailApi, MAIN_DATASET)).toBe(response.data.etag);
  });

  test("keeps the previous version as a .bak beside the dataset", async ({ appTrailApi, mainDataset }) => {
    const response = await appTrailApi.putDataset<SavedResponse>(MAIN_DATASET, FELLOWSHIP, mainDataset.etag);

    expect(response.status).toBe(200);
    expect(dataStore.read(BACKUP)).toBe(HOMESTAR);
  });

  test("overwrites regardless of what is on disk with If-Match: *", async ({ appTrailApi }) => {
    const response = await appTrailApi.putDataset<SavedResponse>(MAIN_DATASET, FELLOWSHIP, "*");

    expect(response.status).toBe(200);
    expect(response.data).toEqual({ ok: true, etag: response.headers["etag"] });
    expect(dataStore.read(MAIN_DATASET)).toBe(FELLOWSHIP);
    expect(response).toMatchSpec();
  });

  test("replaces a data.json that is not valid JSON with If-Match: *", async ({ appTrailApi }) => {
    dataStore.write(MAIN_DATASET, "{ not json");

    const response = await appTrailApi.putDataset<SavedResponse>(MAIN_DATASET, FELLOWSHIP, "*");

    expect(response.status).toBe(200);
    expect(dataStore.read(MAIN_DATASET)).toBe(FELLOWSHIP);
    expect(response).toMatchSpec();
  });

  test("refuses a stale ETag with 409 and the current document, leaving the file alone", async ({ appTrailApi, mainDataset }) => {
    const response = await appTrailApi.putDataset<ConflictResponse>(MAIN_DATASET, FELLOWSHIP, STALE_ETAG);

    expect(response.status).toBe(409);
    expect(response.data).toEqual({ conflict: true, etag: mainDataset.etag, data: HOMESTAR_DOC });
    expect(response.headers["etag"]).toBe(mainDataset.etag);
    expect(dataStore.read(MAIN_DATASET)).toBe(HOMESTAR);
    expect(response).toMatchSpec();
  });

  test("refuses a write with no If-Match header with 428, leaving the file alone", async ({ appTrailApi }) => {
    const response = await appTrailApi.putDataset<string>(MAIN_DATASET, FELLOWSHIP);

    expect(response.status).toBe(428);
    expect(response.data).toBe(ErrorMessages.ifMatchRequired("PUT", Routes.dataset(MAIN_DATASET)));
    expect(dataStore.read(MAIN_DATASET)).toBe(HOMESTAR);
    expect(response).toMatchSpec();
  });

  test("refuses a body that is not valid JSON with 400, leaving the file alone", async ({ appTrailApi }) => {
    const response = await appTrailApi.putDataset<string>(MAIN_DATASET, "{ not json", "*");

    expect(response.status).toBe(400);
    expect(response.data.startsWith(ErrorMessages.COULD_NOT_SAVE_PREFIX)).toBe(true);
    expect(dataStore.read(MAIN_DATASET)).toBe(HOMESTAR);
    expect(response).toMatchSpec();
  });

  test("refuses a body over 25 MiB with 413 and closes the connection, leaving the file alone", async ({ appTrailApi }) => {
    const oversized = FELLOWSHIP.padEnd(DatasetLimits.MAX_BODY_BYTES + 1, " ");   // still valid JSON, one byte too many

    const response = await appTrailApi.putDataset<string>(MAIN_DATASET, oversized, "*");

    expect(response.status).toBe(413);
    expect(response.data).toBe(ErrorMessages.DATASET_TOO_LARGE);
    expect(response.headers["connection"]).toBe("close");
    expect(dataStore.read(MAIN_DATASET)).toBe(HOMESTAR);
    expect(response).toMatchSpec();
  });

  test("creates another dataset with If-Match: *", async ({ appTrailApi, newDatasetName }) => {
    const name = newDatasetName();

    const response = await appTrailApi.putDataset<SavedResponse>(name, FELLOWSHIP, "*");

    expect(response.status).toBe(200);
    expect(response.data).toEqual({ ok: true, etag: response.headers["etag"] });
    expect(dataStore.read(name)).toBe(FELLOWSHIP);
    expect(response).toMatchSpec();
  });

  test("refuses to create another dataset with an ETag, answering 409 with nulls", async ({ appTrailApi, newDatasetName }) => {
    const name = newDatasetName();

    const response = await appTrailApi.putDataset<ConflictResponse>(name, FELLOWSHIP, STALE_ETAG);

    expect(response.status).toBe(409);
    expect(response.data).toEqual({ conflict: true, etag: null, data: null });
    expect(response.headers["etag"]).toBeUndefined();
    expect(dataStore.exists(name)).toBe(false);
    expect(response).toMatchSpec();
  });

  test("refuses to write the backup file with 404, leaving it alone", async ({ appTrailApi }) => {
    dataStore.write(BACKUP, HOMESTAR);

    const response = await appTrailApi.putDataset<string>(BACKUP, FELLOWSHIP, "*");

    expect(response.status).toBe(404);
    expect(response.data).toBe(ErrorMessages.NOT_FOUND);
    expect(dataStore.read(BACKUP)).toBe(HOMESTAR);
    expect(response).toMatchSpec();
  });

  /* On a case-insensitive disk Data.json is data.json, and a write to it would
     replace the tracker without the change being announced to the open page. */
  test("refuses a name that differs from data.json only in case with 404, leaving data.json alone", async ({ appTrailApi }) => {
    const response = await appTrailApi.putDataset<string>("Data.json", FELLOWSHIP, "*");

    expect(response.status).toBe(404);
    expect(response.data).toBe(ErrorMessages.NOT_FOUND);
    expect(dataStore.read(MAIN_DATASET)).toBe(HOMESTAR);
    expect(response).toMatchSpec();
  });
});

test.describe("POST /data/{name}", { tag: ["@endpoint:POST:/data/{name}"] }, () => {
  test("replaces the dataset the same way PUT does", async ({ appTrailApi, mainDataset }) => {
    const response = await appTrailApi.postDataset<SavedResponse>(MAIN_DATASET, FELLOWSHIP, mainDataset.etag);

    expect(response.status).toBe(200);
    expect(response.data).toEqual({ ok: true, etag: response.headers["etag"] });
    expect(dataStore.read(MAIN_DATASET)).toBe(FELLOWSHIP);
    expect(response).toMatchSpec();
  });

  test("refuses a write with no If-Match header with 428 naming POST, leaving the file alone", async ({ appTrailApi }) => {
    const response = await appTrailApi.postDataset<string>(MAIN_DATASET, FELLOWSHIP);

    expect(response.status).toBe(428);
    expect(response.data).toBe(ErrorMessages.ifMatchRequired("POST", Routes.dataset(MAIN_DATASET)));
    expect(dataStore.read(MAIN_DATASET)).toBe(HOMESTAR);
    expect(response).toMatchSpec();
  });
});
