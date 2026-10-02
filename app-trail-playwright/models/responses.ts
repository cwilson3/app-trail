import type { SpecPath } from "../constants/routes";
import type { TrackerDocument } from "./tracker";

/** The request a response answered: its method, and the spec path its URL belongs to (null for none). */
export type Operation = { method: string; specPath: SpecPath | null };

export type ApiResponse<T> = {
  status: number;
  headers: Record<string, string>;
  data: T;
  url: string;
  operation: Operation;
};

export type HealthResponse = { ok: true; file: string };

export type JobDescriptionsResponse = { ok: true; dir: "jds"; files: string[] };

export type SavedResponse = { ok: true; etag: string };

export type ConflictResponse = {
  conflict: true;
  etag: string | null;
  data: TrackerDocument | null;
};

export type NoteWrittenResponse = { ok: true; action: string; rows: number; title: string; folder: string };

export type NoteErrorResponse = { ok: false; error: string };
