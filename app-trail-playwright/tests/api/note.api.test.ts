import { test, expect } from "../../fixtures/api.fixture";
import { NoteLimits } from "../../constants/limits";
import { ErrorMessages } from "../../constants/messages";
import type { NoteErrorResponse, NoteWrittenResponse } from "../../models/responses";
import type { NoteRequest } from "../../models/tracker";

const TITLE = "Fellowship Search";
const FOLDER = "Quests";
const DEFAULT_TITLE = "JS-2026";
const { MAX_COLUMNS, MAX_ROWS, MAX_CELL_LENGTH, MAX_BODY_BYTES } = NoteLimits;
const TABLE: NoteRequest = {
  columns: ["Company", "Role"],
  rows: [["Bag End", "Gardener"], ["Rivendell", "Archivist"]],
};

/* config.json is absent and the note sink empty at the start of every test
   (the configFile and noteSink fixtures). */

test.describe("POST /api/note", { tag: ["@endpoint:POST:/api/note"] }, () => {
  test.describe("writing the note", () => {
    test("creates the note config.json names, in its folder", async ({ appTrailApi, configFile, noteSink }) => {
      configFile.writeNote(TITLE, FOLDER);

      const response = await appTrailApi.writeNote<NoteWrittenResponse>(TABLE);

      expect(response.status).toBe(200);
      expect(response.data).toEqual({ ok: true, action: "created", rows: 2, title: TITLE, folder: FOLDER });
      expect(noteSink.recorded().map(n => [n.title, n.folder])).toEqual([[TITLE, FOLDER]]);
      expect(response).toMatchSpec();
    });

    test("updates the note in place when it already exists", async ({ appTrailApi, configFile, noteSink }) => {
      configFile.writeNote(TITLE, FOLDER);
      await appTrailApi.writeNote<NoteWrittenResponse>(TABLE);

      const response = await appTrailApi.writeNote<NoteWrittenResponse>({ columns: ["Company"], rows: [["Bree"]] });

      expect(response.status).toBe(200);
      expect(response.data).toEqual({ ok: true, action: "updated", rows: 1, title: TITLE, folder: FOLDER });
      const notes = noteSink.recorded();
      expect(notes).toHaveLength(1);
      expect(notes[0].body).toContain("<td>Bree</td>");
      expect(notes[0].body).not.toContain("Rivendell");
    });

    test("writes to the JS-2026 note in the default folder when there is no config.json", async ({ appTrailApi, noteSink }) => {
      const response = await appTrailApi.writeNote<NoteWrittenResponse>(TABLE);

      expect(response.status).toBe(200);
      expect(response.data).toEqual({ ok: true, action: "created", rows: 2, title: DEFAULT_TITLE, folder: "" });
      expect(noteSink.recorded().map(n => [n.title, n.folder])).toEqual([[DEFAULT_TITLE, ""]]);
    });

    test("falls back to the defaults when config.json is not valid JSON", async ({ appTrailApi, configFile }) => {
      configFile.write("{ not json");

      const response = await appTrailApi.writeNote<NoteWrittenResponse>(TABLE);

      expect(response.status).toBe(200);
      expect(response.data).toEqual({ ok: true, action: "created", rows: 2, title: DEFAULT_TITLE, folder: "" });
    });

    test("reports the action as 'written' when osascript prints nothing", async ({ appTrailApi, noteSink }) => {
      noteSink.failNext({ stdout: "" });

      const response = await appTrailApi.writeNote<NoteWrittenResponse>(TABLE);

      expect(response.status).toBe(200);
      expect(response.data.action).toBe("written");
      expect(noteSink.recorded()).toHaveLength(1);
    });

    test(`accepts exactly ${MAX_COLUMNS} columns`, async ({ appTrailApi }) => {
      const columns = Array.from({ length: MAX_COLUMNS }, (_, i) => `Column ${i + 1}`);

      const response = await appTrailApi.writeNote<NoteWrittenResponse>({ columns, rows: [] });

      expect(response.status).toBe(200);
      expect(response.data).toEqual({ ok: true, action: "created", rows: 0, title: DEFAULT_TITLE, folder: "" });
    });

    test(`accepts a body of exactly ${MAX_BODY_BYTES / 1024} KiB`, async ({ appTrailApi, noteSink }) => {
      const body = JSON.stringify(TABLE).padEnd(MAX_BODY_BYTES, " ");

      const response = await appTrailApi.writeNote<NoteWrittenResponse>(body);

      expect(response.status).toBe(200);
      expect(noteSink.recorded()).toHaveLength(1);
    });

    test(`accepts exactly ${MAX_ROWS} rows`, async ({ appTrailApi }) => {
      const rows = Array.from({ length: MAX_ROWS }, () => ["Bag End"]);

      const response = await appTrailApi.writeNote<NoteWrittenResponse>({ columns: ["Company"], rows });

      expect(response.status).toBe(200);
      expect(response.data).toEqual({ ok: true, action: "created", rows: MAX_ROWS, title: DEFAULT_TITLE, folder: "" });
    });
  });

  test.describe("the note body", () => {
    test("leads with the title, which Notes takes as the note's name", async ({ appTrailApi, configFile, noteSink }) => {
      configFile.writeNote(TITLE, FOLDER);

      await appTrailApi.writeNote<NoteWrittenResponse>(TABLE);

      expect(noteSink.recorded()[0].body.startsWith(`<h1>${TITLE}</h1>`)).toBe(true);
    });

    test("holds the header row in bold, then every row in order", async ({ appTrailApi, noteSink }) => {
      await appTrailApi.writeNote<NoteWrittenResponse>(TABLE);

      expect(noteSink.recorded()[0].body).toContain(
        "<table><tr><td><b>Company</b></td><td><b>Role</b></td></tr>" +
        "<tr><td>Bag End</td><td>Gardener</td></tr>" +
        "<tr><td>Rivendell</td><td>Archivist</td></tr></table>");
    });

    test("escapes HTML in the title and the cells", async ({ appTrailApi, configFile, noteSink }) => {
      configFile.writeNote("<i>Search</i>", FOLDER);

      await appTrailApi.writeNote<NoteWrittenResponse>({ columns: ["Company"], rows: [['<script>x</script> & "Co"']] });

      const body = noteSink.recorded()[0].body;
      expect(body).toContain("<h1>&lt;i&gt;Search&lt;/i&gt;</h1>");
      expect(body).toContain("<td>&lt;script&gt;x&lt;/script&gt; &amp; &quot;Co&quot;</td>");
      expect(body).not.toContain("<script>");
    });

    test(`cuts every cell to ${MAX_CELL_LENGTH} characters`, async ({ appTrailApi, noteSink }) => {
      await appTrailApi.writeNote<NoteWrittenResponse>({ columns: ["Notes"], rows: [["x".repeat(MAX_CELL_LENGTH + 100)]] });

      expect(noteSink.recorded()[0].body).toContain(`<td>${"x".repeat(MAX_CELL_LENGTH)}</td>`);
    });

    test("pads short rows and trims long rows to the number of columns", async ({ appTrailApi, noteSink }) => {
      await appTrailApi.writeNote<NoteWrittenResponse>({ columns: ["A", "B"], rows: [["1"], ["1", "2", "3"]] });

      const body = noteSink.recorded()[0].body;
      expect(body).toContain("<tr><td>1</td><td></td></tr>");
      expect(body).toContain("<tr><td>1</td><td>2</td></tr>");
      expect(body).not.toContain("<td>3</td>");
    });

    test("writes numbers as text and null as an empty cell", async ({ appTrailApi, noteSink }) => {
      await appTrailApi.writeNote<NoteWrittenResponse>({ columns: ["A", "B"], rows: [[42, null]] });

      expect(noteSink.recorded()[0].body).toContain("<tr><td>42</td><td></td></tr>");
    });
  });

  test.describe("refusing the table", () => {
    test("refuses a table with no columns with 400, writing nothing", async ({ appTrailApi, noteSink }) => {
      const response = await appTrailApi.writeNote<NoteErrorResponse>({ columns: [], rows: [] });

      expect(response.status).toBe(400);
      expect(response.data).toEqual({ ok: false, error: ErrorMessages.NOTE_COLUMNS });
      expect(noteSink.recorded()).toEqual([]);
      expect(response).toMatchSpec();
    });

    test(`refuses a table with more than ${MAX_COLUMNS} columns with 400, writing nothing`, async ({ appTrailApi, noteSink }) => {
      const columns = Array.from({ length: MAX_COLUMNS + 1 }, (_, i) => `Column ${i + 1}`);

      const response = await appTrailApi.writeNote<NoteErrorResponse>({ columns, rows: [] });

      expect(response.status).toBe(400);
      expect(response.data).toEqual({ ok: false, error: ErrorMessages.NOTE_COLUMNS });
      expect(noteSink.recorded()).toEqual([]);
      expect(response).toMatchSpec();
    });

    test(`refuses a table with more than ${MAX_ROWS} rows with 400, writing nothing`, async ({ appTrailApi, noteSink }) => {
      const rows = Array.from({ length: MAX_ROWS + 1 }, () => ["Bag End"]);

      const response = await appTrailApi.writeNote<NoteErrorResponse>({ columns: ["Company"], rows });

      expect(response.status).toBe(400);
      expect(response.data).toEqual({ ok: false, error: ErrorMessages.NOTE_ROWS });
      expect(noteSink.recorded()).toEqual([]);
      expect(response).toMatchSpec();
    });

    test("refuses a row that is not an array of cells with 400, writing nothing", async ({ appTrailApi, noteSink }) => {
      const response = await appTrailApi.writeNote<NoteErrorResponse>({ columns: ["Company"], rows: ["Bag End"] });

      expect(response.status).toBe(400);
      expect(response.data).toEqual({ ok: false, error: ErrorMessages.NOTE_ROW_NOT_ARRAY });
      expect(noteSink.recorded()).toEqual([]);
      expect(response).toMatchSpec();
    });

    test(`refuses a body over ${MAX_BODY_BYTES / 1024} KiB with 413 and closes the connection, writing nothing`, async ({ appTrailApi, noteSink }) => {
      const body = JSON.stringify(TABLE).padEnd(MAX_BODY_BYTES + 1, " ");

      const response = await appTrailApi.writeNote<NoteErrorResponse>(body);

      expect(response.status).toBe(413);
      expect(response.data).toEqual({ ok: false, error: ErrorMessages.NOTE_TOO_LARGE });
      expect(response.headers["connection"]).toBe("close");
      expect(noteSink.recorded()).toEqual([]);
      expect(response).toMatchSpec();
    });

    test("refuses a body that is not JSON with 400, writing nothing", async ({ appTrailApi, noteSink }) => {
      const response = await appTrailApi.writeNote<NoteErrorResponse>("{ not json");

      expect(response.status).toBe(400);
      expect(response.data.ok).toBe(false);
      expect(noteSink.recorded()).toEqual([]);
      expect(response).toMatchSpec();
    });
  });

  test.describe("when osascript fails", () => {
    test("answers 403 with how to allow it when macOS refuses automation", async ({ appTrailApi, noteSink }) => {
      noteSink.failNext({ exitCode: 1, stderr: "execution error: Not authorized to send Apple events to Notes. (-1743)" });

      const response = await appTrailApi.writeNote<NoteErrorResponse>(TABLE);

      expect(response.status).toBe(403);
      expect(response.data).toEqual({ ok: false, error: ErrorMessages.NOTE_NOT_AUTHORIZED });
      expect(noteSink.recorded()).toEqual([]);
      expect(response).toMatchSpec();
    });

    test("answers 500 with osascript's own error for any other failure", async ({ appTrailApi, noteSink }) => {
      const stderr = "execution error: Notes got an error: AppleEvent timed out. (-1712)";
      noteSink.failNext({ exitCode: 1, stderr });

      const response = await appTrailApi.writeNote<NoteErrorResponse>(TABLE);

      expect(response.status).toBe(500);
      expect(response.data).toEqual({ ok: false, error: stderr });
      expect(noteSink.recorded()).toEqual([]);
      expect(response).toMatchSpec();
    });
  });
});
