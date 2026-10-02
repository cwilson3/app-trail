import { DatasetLimits, NoteLimits } from "./limits";

const KIB = 1024, MIB = 1024 * 1024;

export const ErrorMessages = {
  NOT_FOUND: "Not found",
  METHOD_NOT_ALLOWED: "Method not allowed",
  foreignRequest: (header: "Host" | "Origin") => `Forbidden: ${header} is not this server`,
  UNSUPPORTED_MEDIA_TYPE: "Content-Type must be application/json",
  ifMatchRequired: (method: "PUT" | "POST", pathname: string) =>
    `${method} ${pathname} needs an If-Match header carrying the ETag you last read (or * to overwrite regardless).`,
  COULD_NOT_SAVE_PREFIX: "Could not save: ",
  DATASET_TOO_LARGE: `Could not save: The body is over ${DatasetLimits.MAX_BODY_BYTES / MIB} MiB.`,
  couldNotRead: (pathname: string) => `${pathname} could not be read: `,
  NOTE_COLUMNS: `Expected between ${NoteLimits.MIN_COLUMNS} and ${NoteLimits.MAX_COLUMNS} columns.`,
  NOTE_ROWS: `Expected at most ${NoteLimits.MAX_ROWS} rows.`,
  NOTE_ROW_NOT_ARRAY: "Every row must be an array of cells.",
  NOTE_TOO_LARGE: `The body is over ${NoteLimits.MAX_BODY_BYTES / KIB} KiB.`,
  NOTE_NOT_AUTHORIZED:
    "macOS has not allowed this to control Notes. Approve it under System Settings > Privacy & Security > Automation.",
} as const;
