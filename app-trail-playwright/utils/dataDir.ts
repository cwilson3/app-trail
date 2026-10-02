import fs from "fs";
import path from "path";

/**
 * The folder the server under test keeps its data in - .test-run/ unless
 * APP_TRAIL_DATA_DIR names another. playwright.config.ts hands the same folder
 * to the server and wipes it at the start of every run.
 */
export const DATA_DIR = path.resolve(process.env.APP_TRAIL_DATA_DIR ?? path.join(__dirname, "..", ".test-run"));
export const MAIN_DATASET = "data.json";
export const BACKUP = `${MAIN_DATASET}.bak`;

const TEST_DATA_DIR = path.join(__dirname, "..", ".test-data");

/** The committed datasets' bytes, exactly as they are on disk, and an empty tracker. */
export const TestDocs = {
  FELLOWSHIP: fs.readFileSync(path.join(TEST_DATA_DIR, "test-data-1.fellowship.json"), "utf8"),
  HOMESTAR: fs.readFileSync(path.join(TEST_DATA_DIR, "test-data-2.homestar.json"), "utf8"),
  EMPTY: JSON.stringify({ version: 1, savedAt: null, applications: [] }),
} as const;

/**
 * How tests arrange and inspect the server's data folder behind its back -
 * the files it reads, and the ones it wrote. Everything a test does to the
 * folder goes through this, so a server running elsewhere needs only another
 * implementation.
 */
export interface DataStore {
  /** The absolute path the server reports for a file in its data folder. */
  pathOf(name: string): string;
  read(name: string): string;
  exists(name: string): boolean;
  write(name: string, raw: string): void;
  remove(name: string): void;
  /** `name` may contain slashes; folders under jds/ are created as needed. */
  writeJobDescription(name: string, text: string): void;
  removeJobDescriptions(): void;
}

export function localDataStore(dir: string): DataStore {
  const at = (name: string) => path.join(dir, name);
  const jds = at("jds");
  return {
    pathOf: at,
    read: name => fs.readFileSync(at(name), "utf8"),
    exists: name => fs.existsSync(at(name)),
    write: (name, raw) => fs.writeFileSync(at(name), raw),
    remove: name => fs.rmSync(at(name), { force: true }),
    writeJobDescription(name, text) {
      const file = path.join(jds, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    },
    removeJobDescriptions: () => fs.rmSync(jds, { recursive: true, force: true }),
  };
}

export const dataStore: DataStore = localDataStore(DATA_DIR);
