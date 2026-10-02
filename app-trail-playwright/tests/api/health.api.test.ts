import { test, expect } from "../../fixtures/api.fixture";
import type { HealthResponse } from "../../models/responses";
import { MAIN_DATASET, dataStore } from "../../utils/dataDir";

test.describe("GET /api/health", { tag: ["@endpoint:GET:/api/health"] }, () => {
  test("reports ok and the data.json it serves from the data folder", async ({ appTrailApi }) => {
    const response = await appTrailApi.getHealth<HealthResponse>();

    expect(response.status).toBe(200);
    expect(response.data).toEqual({ ok: true, file: dataStore.pathOf(MAIN_DATASET) });
    expect(response).toMatchSpec();
  });
});
