import { test, expect } from "../../fixtures/api.fixture";
import type { HealthResponse } from "../../models/responses";
import { DATA_DIR, MAIN_DATASET, dataStore } from "../../utils/dataDir";

test.describe("GET /api/health", { tag: ["@endpoint:GET:/api/health"] }, () => {
  test("reports ok, the data folder, and the data.json it serves from it", async ({ appTrailApi }) => {
    const response = await appTrailApi.getHealth<HealthResponse>();

    expect(response.status).toBe(200);
    expect(response.data).toEqual({ ok: true, file: dataStore.pathOf(MAIN_DATASET), dir: DATA_DIR });
    expect(response).toMatchSpec();
  });
});
