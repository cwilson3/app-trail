import path from "path";

/**
 * Where the auth setup files save each site's signed-in browser state. These
 * hold live session cookies, so playwright/.auth/ is gitignored.
 */
const AUTH_DIR = path.join(__dirname, "..", "playwright", ".auth");

export const AuthStates = {
  LINKEDIN: path.join(AUTH_DIR, "linkedin.json"),
  LADDERS: path.join(AUTH_DIR, "ladders.json"),
} as const;

/** How long a setup file leaves the login page open for you to sign in by hand. */
export const MANUAL_LOGIN_WAIT_MS = 35_000;
