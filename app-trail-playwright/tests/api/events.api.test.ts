import { test, expect } from "../../fixtures/api.fixture";
import { MAIN_DATASET, TestDocs, dataStore } from "../../utils/dataDir";
import { currentEtag, replaceDataset } from "../../utils/datasetHelpers";

const { FELLOWSHIP, EMPTY } = TestDocs;

/* Every test starts with HOMESTAR as data.json (the mainDataset fixture). */

test.describe("GET /api/events", { tag: ["@endpoint:GET:/api/events"] }, () => {
  test("opens an event stream with a retry interval and the current ETag", async ({ mainDataset, openEventStream }) => {
    const stream = await openEventStream();

    expect(stream.status).toBe(200);
    expect(stream.headers["content-type"]).toBe("text/event-stream; charset=utf-8");
    expect(await stream.next()).toEqual({ retry: 2000 });
    expect(await stream.next()).toEqual({ event: "change", data: JSON.stringify({ etag: mainDataset.etag }) });
  });

  test("sends a change event with the new ETag when data.json is saved through the server", async ({ appTrailApi, openEventStream }) => {
    const stream = await openEventStream();
    await stream.nextChange();

    const saved = await replaceDataset(appTrailApi, MAIN_DATASET, FELLOWSHIP);

    expect(await stream.nextChange()).toBe(saved);
  });

  test("sends a change event when data.json is edited on disk, behind the server's back", async ({ appTrailApi, openEventStream }) => {
    const stream = await openEventStream();
    const before = await stream.nextChange();

    dataStore.write(MAIN_DATASET, FELLOWSHIP);

    const announced = await stream.nextChange();
    expect(announced).not.toBe(before);
    expect(announced).toBe(await currentEtag(appTrailApi, MAIN_DATASET));
  });

  test("still announces an edit on disk when data.json is read before the change is noticed", async ({ appTrailApi, openEventStream }) => {
    const stream = await openEventStream();
    await stream.nextChange();

    dataStore.write(MAIN_DATASET, FELLOWSHIP);
    const read = await currentEtag(appTrailApi, MAIN_DATASET);   // a page reloading straight away

    expect(await stream.nextChange()).toBe(read);
  });

  test("still announces an edit on disk when another page connects before the change is noticed", async ({ appTrailApi, openEventStream }) => {
    const stream = await openEventStream();
    await stream.nextChange();

    dataStore.write(MAIN_DATASET, FELLOWSHIP);
    await openEventStream();

    expect(await stream.nextChange()).toBe(await currentEtag(appTrailApi, MAIN_DATASET));
  });

  test("sends no event for a save to another dataset", async ({ appTrailApi, openEventStream, newDatasetName }) => {
    const stream = await openEventStream();
    await stream.nextChange();

    const otherEtag = await replaceDataset(appTrailApi, newDatasetName(), EMPTY);
    const mainEtag = await replaceDataset(appTrailApi, MAIN_DATASET, FELLOWSHIP);

    const announced: string[] = [];
    while (announced.at(-1) !== mainEtag) announced.push(await stream.nextChange());
    expect(announced).not.toContain(otherEtag);
  });
});
