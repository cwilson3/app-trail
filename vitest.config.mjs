import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Playwright's API and E2E specs live here and run under Playwright, not Vitest.
    exclude: [...configDefaults.exclude, "app-trail-playwright/**"],
  },
});
