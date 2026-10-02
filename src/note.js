/**
 * The Note button: the table the page can see, written into a note in
 * Notes.app. server.js answers POST /api/note with what is here.
 *
 * Notes can only be driven from this machine, through osascript. Which note
 * is written comes from config.json in the data folder, read on every request
 * so an edit takes effect without a restart.
 */

const fs = require("fs");
const { execFile } = require("child_process");

/* What a table may hold. spec.yml documents the column and row limits as the
   request's maxItems, and note.test.js keeps the two in step. A cell longer
   than maxCell is cut, not refused; a body over maxBody is refused with 413. */
const NOTE_LIMITS = Object.freeze({ minColumns: 1, maxColumns: 20, maxRows: 5000, maxCell: 500, maxBody: 512 * 1024 });

const NOTE_DEFAULTS = Object.freeze({ title: "JS-2026", folder: "" });

/**
 * Which note to write: `note.title` and `note.folder` from config.json, or the
 * defaults when the file is missing or unreadable.
 *
 * @param {string} configFile
 * @param {{ fsp?: typeof fs.promises, warn?: (line: string) => void }} [opts]
 */
async function readNoteConfig(configFile, { fsp = fs.promises, warn = console.warn } = {}) {
  let parsed;
  try {
    parsed = JSON.parse(await fsp.readFile(configFile, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") warn("  config.json ignored: " + e.message);
    return Object.assign({}, NOTE_DEFAULTS);
  }
  const n = parsed && typeof parsed.note === "object" && parsed.note ? parsed.note : {};
  const str = (v, dflt) => (typeof v === "string" && v.trim() ? v.trim() : dflt);
  return { title: str(n.title, NOTE_DEFAULTS.title), folder: str(n.folder, "") };
}

/* The page decides what is on screen - its filter and its sort order live in
   the browser - so it sends the finished cells and we only escape them. */
function parseNotePayload(raw) {
  const p = JSON.parse(raw);
  const { minColumns, maxColumns, maxRows, maxCell } = NOTE_LIMITS;
  const cell = v => String(v == null ? "" : v).slice(0, maxCell);
  if (!Array.isArray(p.columns) || p.columns.length < minColumns || p.columns.length > maxColumns) {
    throw new Error("Expected between " + minColumns + " and " + maxColumns + " columns.");
  }
  if (!Array.isArray(p.rows) || p.rows.length > maxRows) {
    throw new Error("Expected at most " + maxRows + " rows.");
  }
  const columns = p.columns.map(cell);
  const rows = p.rows.map(r => {
    if (!Array.isArray(r)) throw new Error("Every row must be an array of cells.");
    const out = r.slice(0, columns.length).map(cell);
    while (out.length < columns.length) out.push("");
    return out;
  });
  return { columns, rows };
}

const escHtml = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* Notes takes HTML and derives the note's title from the first line, which is
   also what `whose name is` matches on - so the title has to lead the body. */
function noteHtml(title, columns, rows, at = new Date()) {
  const cells = (row, tag) => row.map(v => "<td>" + tag(escHtml(v)) + "</td>").join("");
  const plain = v => v, bold = v => "<b>" + v + "</b>";
  return "<h1>" + escHtml(title) + "</h1>" +
    "<div>" + rows.length + " application" + (rows.length === 1 ? "" : "s") +
      " &middot; exported " + escHtml(at.toLocaleString()) + "</div>" +
    "<table><tr>" + cells(columns, bold) + "</tr>" +
    rows.map(r => "<tr>" + cells(r, plain) + "</tr>").join("") + "</table>";
}

/* The title, the folder and the body all reach osascript as argv entries, so
   AppleScript receives them as strings and never as script it might run. No
   shell is involved either - execFile, not exec. */
const NOTE_SCRIPT = [
  "on run argv",
  "  set noteTitle to item 1 of argv",
  "  set folderName to item 2 of argv",
  "  set noteBody to item 3 of argv",
  "  tell application \"Notes\"",
  "    set acct to default account",
  "    if folderName is \"\" then",
  "      set tgt to default folder of acct",
  "    else",
  "      if not (exists folder folderName of acct) then",
  "        make new folder at acct with properties {name:folderName}",
  "      end if",
  "      set tgt to folder folderName of acct",
  "    end if",
  "    set hits to (every note of tgt whose name is noteTitle)",
  "    if (count of hits) is 0 then",
  "      make new note at tgt with properties {body:noteBody}",
  "      return \"created\"",
  "    else",
  "      set body of (item 1 of hits) to noteBody",
  "      return \"updated\"",
  "    end if",
  "  end tell",
  "end run"
].join("\n");

/**
 * A function that writes a note by running `command` the way osascript is
 * run - the script on stdin, then "-", the title, the folder and the body as
 * arguments - and resolves with what it printed. Anything other than
 * osascript lets the API tests record the note instead of writing one into
 * Notes.app on the machine running them.
 *
 * @param {string} command
 * @returns {(title: string, folder: string, body: string) => Promise<string>}
 */
function noteRunner(command) {
  return (title, folder, body) => new Promise((resolve, reject) => {
    const child = execFile(command, ["-", title, folder, body],
      { timeout: 30000 }, (err, stdout, stderr) => {
        if (err) return reject(new Error((stderr || err.message).trim()));
        resolve(stdout.trim() || "written");
      });
    child.stdin.on("error", () => {});   // osascript can exit before we finish writing
    child.stdin.end(NOTE_SCRIPT);
  });
}

/* Almost always the automation prompt: macOS asks once per app, and a refusal
   (or a dismissed prompt) comes back as -1743. */
const isAutomationDenied = (/** @type {string} */ message) => /-1743|not authori[sz]ed/i.test(message);

const AUTOMATION_DENIED =
  "macOS has not allowed this to control Notes. Approve it under System Settings > Privacy & Security > Automation.";

module.exports = {
  NOTE_LIMITS, NOTE_DEFAULTS, NOTE_SCRIPT, AUTOMATION_DENIED,
  readNoteConfig, parseNotePayload, noteHtml, noteRunner, isAutomationDenied
};
