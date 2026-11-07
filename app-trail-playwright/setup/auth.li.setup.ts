import { test as setup } from "@playwright/test";
import { AuthStates, MANUAL_LOGIN_WAIT_MS } from "../constants/authStates";

// Nothing is filled in: sign in by hand while the page waits, then the
// browser's state is saved for later runs to reuse.
setup("sign in to LinkedIn", async ({ page }) => {
  setup.setTimeout(MANUAL_LOGIN_WAIT_MS + 30_000);

  await page.goto("https://www.linkedin.com/login");
  await page.waitForTimeout(MANUAL_LOGIN_WAIT_MS);

  await page.context().storageState({ path: AuthStates.LINKEDIN });
});
