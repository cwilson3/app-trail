import { test, expect } from "../../fixtures/api.fixture";
import { ErrorMessages } from "../../constants/messages";
import type { JobDescriptionsResponse } from "../../models/responses";

const JD_TEXT = "# Shire Post - Courier\n\nRound trips to Bree, weekly.\n";

test.describe("GET /api/jds", { tag: ["@endpoint:GET:/api/jds"] }, () => {
  test("lists only the .md files under jds/, sorted by name", async ({ appTrailApi, jobDescriptions }) => {
    jobDescriptions.write("rivendell-archivist.md", JD_TEXT);
    jobDescriptions.write("bag-end-gardener.MD", JD_TEXT);
    jobDescriptions.write("notes.txt", JD_TEXT);

    const response = await appTrailApi.listJobDescriptions<JobDescriptionsResponse>();

    expect(response.status).toBe(200);
    expect(response.data).toEqual({ ok: true, dir: "jds", files: ["bag-end-gardener.MD", "rivendell-archivist.md"] });
    expect(response).toMatchSpec();
  });

  test("returns an empty list when jds/ does not exist", async ({ appTrailApi }) => {
    const response = await appTrailApi.listJobDescriptions<JobDescriptionsResponse>();

    expect(response.status).toBe(200);
    expect(response.data).toEqual({ ok: true, dir: "jds", files: [] });
    expect(response).toMatchSpec();
  });
});

test.describe("GET /jds/{name}", { tag: ["@endpoint:GET:/jds/{name}"] }, () => {
  test("returns the job description byte for byte as markdown", async ({ appTrailApi, jobDescriptions }) => {
    jobDescriptions.write("shire-post-courier.md", JD_TEXT);

    const response = await appTrailApi.getJobDescription<string>("shire-post-courier.md");

    expect(response.status).toBe(200);
    expect(response.data).toBe(JD_TEXT);
    expect(response).toMatchSpec();
  });

  test("returns 404 for a job description that does not exist", async ({ appTrailApi }) => {
    const response = await appTrailApi.getJobDescription<string>("mordor-tour-guide.md");

    expect(response.status).toBe(404);
    expect(response.data).toBe(ErrorMessages.NOT_FOUND);
    expect(response).toMatchSpec();
  });

  test("returns 404 for a file in a folder under jds/, even though it exists", async ({ appTrailApi, jobDescriptions }) => {
    jobDescriptions.write("archive/old-posting.md", JD_TEXT);

    const response = await appTrailApi.getJobDescription<string>("archive/old-posting.md");

    expect(response.status).toBe(404);
    expect(response.data).toBe(ErrorMessages.NOT_FOUND);
    expect(response).toMatchSpec();
  });

  test("returns 404 for a dotfile, even though it exists", async ({ appTrailApi, jobDescriptions }) => {
    jobDescriptions.write(".draft.md", JD_TEXT);

    const response = await appTrailApi.getJobDescription<string>(".draft.md");

    expect(response.status).toBe(404);
    expect(response.data).toBe(ErrorMessages.NOT_FOUND);
    expect(response).toMatchSpec();
  });

  test("returns 404 for a file that is not markdown, even though it exists", async ({ appTrailApi, jobDescriptions }) => {
    jobDescriptions.write("notes.txt", JD_TEXT);

    const response = await appTrailApi.getJobDescription<string>("notes.txt");

    expect(response.status).toBe(404);
    expect(response.data).toBe(ErrorMessages.NOT_FOUND);
    expect(response).toMatchSpec();
  });
});
