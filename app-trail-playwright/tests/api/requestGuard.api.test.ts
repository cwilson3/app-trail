import { test, expect } from "../../fixtures/api.fixture";
import { ErrorMessages } from "../../constants/messages";
import { Routes } from "../../constants/routes";
import type { TrackerDocument } from "../../models/tracker";
import { MAIN_DATASET, TestDocs, dataStore } from "../../utils/dataDir";

/* Other web pages open in a browser on this machine can reach 127.0.0.1 too.
   These pin the guard that keeps them out: Host and Origin must name this
   server, and a body is only taken when it is labelled as JSON. */

const { HOMESTAR } = TestDocs;
const FELLOWSHIP_DOC = JSON.parse(TestDocs.FELLOWSHIP) as TrackerDocument;
const FOREIGN_HOST = "evil.example";
const FOREIGN_ORIGIN = "http://evil.example";
const TABLE = { columns: ["Company"], rows: [["Bag End"]] };

/* Every test starts with HOMESTAR as data.json and an empty note sink (the
   mainDataset and noteSink fixtures). */

test.describe("a request whose Host is not this server", { tag: ["@endpoint:GET:/data/{name}"] }, () => {
  test("is refused with 403 before it can read data.json (DNS rebinding)", async ({ appTrailApi, baseURL }) => {
    const port = new URL(baseURL!).port;

    const response = await appTrailApi.send<string>("GET", Routes.dataset(MAIN_DATASET), undefined,
      { Host: `${FOREIGN_HOST}:${port}` });

    expect(response.status).toBe(403);
    expect(response.data).toBe(ErrorMessages.foreignRequest("Host"));
    expect(response).toMatchSpec();
  });

  test("is refused with 403 when it names localhost on another port", async ({ appTrailApi }) => {
    const response = await appTrailApi.send<string>("GET", Routes.dataset(MAIN_DATASET), undefined,
      { Host: "localhost:1" });

    expect(response.status).toBe(403);
    expect(response.data).toBe(ErrorMessages.foreignRequest("Host"));
  });
});

test.describe("a request from a foreign Origin", () => {
  test("cannot overwrite data.json, and gets 403", { tag: ["@endpoint:PUT:/data/{name}"] }, async ({ appTrailApi }) => {
    const response = await appTrailApi.send<string>("PUT", Routes.dataset(MAIN_DATASET), FELLOWSHIP_DOC,
      { "If-Match": "*", Origin: FOREIGN_ORIGIN });

    expect(response.status).toBe(403);
    expect(response.data).toBe(ErrorMessages.foreignRequest("Origin"));
    expect(dataStore.read(MAIN_DATASET)).toBe(HOMESTAR);
    expect(response).toMatchSpec();
  });

  test("cannot write the note, and gets 403", { tag: ["@endpoint:POST:/api/note"] }, async ({ appTrailApi, noteSink }) => {
    const response = await appTrailApi.send<string>("POST", Routes.NOTE, TABLE, { Origin: FOREIGN_ORIGIN });

    expect(response.status).toBe(403);
    expect(response.data).toBe(ErrorMessages.foreignRequest("Origin"));
    expect(noteSink.recorded()).toEqual([]);
    expect(response).toMatchSpec();
  });

  test("is refused with 403 when the Origin is the opaque 'null'", { tag: ["@endpoint:PUT:/data/{name}"] }, async ({ appTrailApi }) => {
    const response = await appTrailApi.send<string>("PUT", Routes.dataset(MAIN_DATASET), FELLOWSHIP_DOC,
      { "If-Match": "*", Origin: "null" });

    expect(response.status).toBe(403);
    expect(dataStore.read(MAIN_DATASET)).toBe(HOMESTAR);
  });
});

test.describe("a request from this server's own Origin", { tag: ["@endpoint:PUT:/data/{name}"] }, () => {
  test("is accepted and written", async ({ appTrailApi, baseURL }) => {
    const origin = new URL(baseURL!).origin;

    const response = await appTrailApi.send("PUT", Routes.dataset(MAIN_DATASET), FELLOWSHIP_DOC,
      { "If-Match": "*", Origin: origin });

    expect(response.status).toBe(200);
    expect(JSON.parse(dataStore.read(MAIN_DATASET))).toEqual(FELLOWSHIP_DOC);
  });
});

test.describe("a body not labelled as JSON", () => {
  test("is refused on PUT /data/{name} with 415, leaving the file alone", { tag: ["@endpoint:PUT:/data/{name}"] }, async ({ appTrailApi }) => {
    const response = await appTrailApi.send<string>("PUT", Routes.dataset(MAIN_DATASET), FELLOWSHIP_DOC,
      { "If-Match": "*", "Content-Type": "text/plain" });

    expect(response.status).toBe(415);
    expect(response.data).toBe(ErrorMessages.UNSUPPORTED_MEDIA_TYPE);
    expect(dataStore.read(MAIN_DATASET)).toBe(HOMESTAR);
    expect(response).toMatchSpec();
  });

  test("is refused on POST /data/{name} with 415, leaving the file alone", { tag: ["@endpoint:POST:/data/{name}"] }, async ({ appTrailApi }) => {
    const response = await appTrailApi.send<string>("POST", Routes.dataset(MAIN_DATASET), FELLOWSHIP_DOC,
      { "If-Match": "*", "Content-Type": "text/plain" });

    expect(response.status).toBe(415);
    expect(dataStore.read(MAIN_DATASET)).toBe(HOMESTAR);
    expect(response).toMatchSpec();
  });

  test("is refused on POST /api/note with 415, writing no note (a no-cors simple request)", { tag: ["@endpoint:POST:/api/note"] }, async ({ appTrailApi, noteSink }) => {
    const response = await appTrailApi.send<string>("POST", Routes.NOTE, TABLE, { "Content-Type": "text/plain" });

    expect(response.status).toBe(415);
    expect(response.data).toBe(ErrorMessages.UNSUPPORTED_MEDIA_TYPE);
    expect(noteSink.recorded()).toEqual([]);
    expect(response).toMatchSpec();
  });

  test("is accepted when the JSON type carries a charset", { tag: ["@endpoint:PUT:/data/{name}"] }, async ({ appTrailApi }) => {
    const response = await appTrailApi.send("PUT", Routes.dataset(MAIN_DATASET), FELLOWSHIP_DOC,
      { "If-Match": "*", "Content-Type": "application/json; charset=utf-8" });

    expect(response.status).toBe(200);
    expect(JSON.parse(dataStore.read(MAIN_DATASET))).toEqual(FELLOWSHIP_DOC);
  });
});

test.describe("static files", () => {
  test("serves the page at /", async ({ appTrailApi }) => {
    const response = await appTrailApi.send<string>("GET", "/");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(response.data).toContain("<title>");
  });

  test("serves jd-name.js, which the page loads to name JD files", async ({ appTrailApi }) => {
    const response = await appTrailApi.send<string>("GET", "/jd-name.js");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(response.data).toContain("function jdName(");
  });

  for (const url of ["/package.json", "/.git/HEAD", "/server.js", "/Data/data.json", "/CONFIG.JSON"]) {
    test(`does not serve ${url} from the repository`, async ({ appTrailApi }) => {
      const response = await appTrailApi.send<string>("GET", url);

      expect(response.status).toBe(404);
      expect(response.data).toBe(ErrorMessages.NOT_FOUND);
    });
  }
});
