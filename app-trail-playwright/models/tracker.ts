export type Application = {
  id: string;
  company?: string;
  roleTitle?: string;
  status?: string;
  [field: string]: unknown;
};

export type TrackerDocument = {
  version?: number;
  savedAt?: string | null;
  applications: Application[];
};

export type NoteRequest = {
  columns: unknown[];
  rows: unknown[];
};
