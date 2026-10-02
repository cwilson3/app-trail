import fs from "fs";
import path from "path";
import { DATA_DIR } from "./dataDir";

/** The stand-in for osascript that the test server runs instead of writing into Notes.app. */
export const FAKE_OSASCRIPT = path.join(__dirname, "..", "support", "fake-osascript.js");
/** Where the stand-in keeps the notes it was asked to write. */
export const NOTE_SINK_DIR = path.join(DATA_DIR, "note-sink");

export type RecordedNote = { title: string; folder: string; body: string; script: string };
export type NextNoteResult = { exitCode?: number; stderr?: string; stdout?: string };

/** Every note written since the sink was last cleared. */
export function recordedNotes(): RecordedNote[] {
  const file = path.join(NOTE_SINK_DIR, "notes.json");
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as RecordedNote[]) : [];
}

/** Makes the next call to the stand-in fail, or print something else. Used once. */
export function setNextNoteResult(result: NextNoteResult): void {
  fs.mkdirSync(NOTE_SINK_DIR, { recursive: true });
  fs.writeFileSync(path.join(NOTE_SINK_DIR, "next-result.json"), JSON.stringify(result));
}

export function clearNoteSink(): void {
  fs.rmSync(NOTE_SINK_DIR, { recursive: true, force: true });
}
