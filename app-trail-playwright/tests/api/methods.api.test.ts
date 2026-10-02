import { test, expect } from "../../fixtures/api.fixture";
import { ErrorMessages } from "../../constants/messages";
import { SpecPaths, sampleUrl } from "../../constants/routes";
import { VERBS, specOperations } from "../../utils/spec";

test.describe("the routes the suite knows", () => {
  test("are exactly the paths spec.yml documents", () => {
    expect(Object.values(SpecPaths).sort()).toEqual(specOperations().map(o => o.path).sort());
  });
});

for (const { path, methods } of specOperations()) {
  /* A method the path does not take. Not HEAD: its answer carries no body, so
     there would be no message to check. */
  const method = VERBS.find(v => v !== "HEAD" && !methods.includes(v))!;

  test.describe(`${method} ${path}`, { tag: [`@endpoint:${method}:${path}`] }, () => {
    test(`refuses with 405 and an Allow header of ${methods.join(", ")}`, async ({ appTrailApi }) => {
      const response = await appTrailApi.send<string>(method, sampleUrl(path));

      expect(response.status).toBe(405);
      expect(response.data).toBe(ErrorMessages.METHOD_NOT_ALLOWED);
      expect(response.headers["allow"], "the Allow header").toBeDefined();
      expect(response.headers["allow"].split(", ").sort()).toEqual([...methods].sort());
      expect(response).toMatchComponent("MethodNotAllowed");
    });
  });
}
