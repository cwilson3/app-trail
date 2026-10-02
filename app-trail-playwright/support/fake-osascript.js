#!/usr/bin/env node
/**
 * Stands in for osascript while the API tests run the server, so POST
 * /api/note can be exercised end to end without writing into Notes.app.
 *
 * Called the way server.js calls osascript: the AppleScript on stdin, then
 * "-", the note's title, its folder and its HTML body as arguments. Like the
 * real script, it creates the note if there is none with that title in that
 * folder and updates it otherwise, and prints which it did.
 *
 * Everything lives under APP_TRAIL_NOTE_SINK:
 *   notes.json        every note written, as [{ title, folder, body, script }]
 *   next-result.json  optional, read once then deleted: { exitCode, stderr,
 *                     stdout } to make the next call fail, or print something
 *                     other than "created"/"updated"
 */

const fs = require("fs");
const path = require("path");

const SINK = process.env.APP_TRAIL_NOTE_SINK;
const [dash, title, folder, body] = process.argv.slice(2);

function exit(code, message) {
  process.stderr.write(message + "\n");
  process.exit(code);
}

if (!SINK) exit(2, "fake-osascript: APP_TRAIL_NOTE_SINK is not set");
if (dash !== "-" || title === undefined || folder === undefined || body === undefined) {
  exit(2, "fake-osascript: expected - <title> <folder> <body>, got " + JSON.stringify(process.argv.slice(2)));
}

let script = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => { script += chunk; });
process.stdin.on("end", () => {
  fs.mkdirSync(SINK, { recursive: true });

  const nextFile = path.join(SINK, "next-result.json");
  let next = {};
  if (fs.existsSync(nextFile)) {
    next = JSON.parse(fs.readFileSync(nextFile, "utf8"));
    fs.rmSync(nextFile);
  }
  if (next.exitCode) exit(next.exitCode, next.stderr || "");

  const notesFile = path.join(SINK, "notes.json");
  const notes = fs.existsSync(notesFile) ? JSON.parse(fs.readFileSync(notesFile, "utf8")) : [];
  const existing = notes.findIndex(n => n.title === title && n.folder === folder);
  const note = { title, folder, body, script };
  if (existing === -1) notes.push(note);
  else notes[existing] = note;
  fs.writeFileSync(notesFile, JSON.stringify(notes, null, 2));

  process.stdout.write((next.stdout ?? (existing === -1 ? "created" : "updated")) + "\n");
});
