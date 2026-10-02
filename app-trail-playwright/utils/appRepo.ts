import path from "path";

/**
 * Where the app under test lives. By default that is the repository this
 * folder sits in; once the suite is moved into a repository of its own,
 * APP_TRAIL_ROOT names a checkout of the app instead, and the variables below
 * can point at each piece separately.
 */
export const APP_ROOT = path.resolve(process.env.APP_TRAIL_ROOT ?? path.join(__dirname, "..", ".."));

/** The server's OpenAPI contract. */
export const SPEC_FILE = path.resolve(process.env.APP_TRAIL_SPEC ?? path.join(APP_ROOT, "spec.yml"));

/** The command that starts the server under test. The port is appended to it. */
export const SERVER_COMMAND = process.env.APP_TRAIL_SERVER_CMD ?? `node "${path.join(APP_ROOT, "src", "server.js")}"`;

/** The job-from-url importer the importer tests run against the server. */
export const IMPORTER = path.join(APP_ROOT, ".claude", "skills", "job-from-url", "scripts", "apply.js");
