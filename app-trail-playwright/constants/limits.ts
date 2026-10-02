import { noteRequestLimits } from "../utils/spec";

/**
 * How big a request the server takes. The column and row limits are read from
 * spec.yml, which documents them as the request schema's minItems and
 * maxItems; the rest are only stated in its prose, so they are written here.
 */
const fromSpec = noteRequestLimits();

export const NoteLimits = {
  MIN_COLUMNS: fromSpec.minColumns,
  MAX_COLUMNS: fromSpec.maxColumns,
  MAX_ROWS: fromSpec.maxRows,
  /** A longer cell is cut to this length, not refused. */
  MAX_CELL_LENGTH: 500,
  MAX_BODY_BYTES: 512 * 1024,
} as const;

export const DatasetLimits = {
  MAX_BODY_BYTES: 25 * 1024 * 1024,
} as const;
