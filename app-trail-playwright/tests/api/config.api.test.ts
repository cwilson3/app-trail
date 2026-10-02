import { test, expect } from "../../fixtures/api.fixture";
import { ErrorMessages } from "../../constants/messages";

const CONFIG_RAW = '{\n  "note": { "title": "Fellowship Search", "folder": "Quests" }\n}\n';

test.describe("GET /config.json", { tag: ["@endpoint:GET:/config.json"] }, () => {
  test("returns the settings in config.json from the data folder", async ({ appTrailApi, configFile }) => {
    configFile.write(CONFIG_RAW);

    const response = await appTrailApi.getConfig<unknown>();

    expect(response.status).toBe(200);
    expect(response.data).toEqual(JSON.parse(CONFIG_RAW));
    expect(response).toMatchSpec();
  });

  test("returns 404 when there is no config.json", async ({ appTrailApi }) => {
    const response = await appTrailApi.getConfig<string>();

    expect(response.status).toBe(404);
    expect(response.data).toBe(ErrorMessages.NOT_FOUND);
    expect(response).toMatchSpec();
  });
});
