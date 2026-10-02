/**
 * Unit tests for opening a separate dataset with Import.
 *
 * Importing data.fellowship.json once wrote it straight over data/data.json.
 * These pin the replacement: an imported file is a dataset of its own, nothing
 * is written until Save, Save asks first and writes to the imported file's own
 * name, and Export and Note work on what is loaded.
 *
 * The app is loaded through test-support/loadIndexApp.js. fetch is a fake
 * server.js that records every request, so "what was written where" is read off it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LS_KEY, doc, fakeServer, loadApp, puts } from "./test-support/loadIndexApp.js";

const MAIN = doc("Acme", "Globex", "Initech");
const FELLOWSHIP = doc("Fellow A", "Fellow B");

/* Picks a file in the Import dialog, the way the browser hands it over. */
async function importFile(app, name, data){
  const input = document.querySelector("#fileInput");
  Object.defineProperty(input, "files", { configurable:true,
    value: [{ name, text: async () => JSON.stringify(data) }] });   // jsdom's File has no text()
  input.dispatchEvent(new Event("change"));
  await vi.waitFor(() => expect([app.mode, window.alert.mock.calls]).toEqual(["dataset", []]));
}

/* Presses a toolbar button and waits for everything the press sets off - the
   prompts, the writes, the toast - so none of it is still running when the
   test ends and its page is closed. */
async function press(selector){
  await document.querySelector(selector).onclick();
}

const companies = app => app.state.applications.map(a => a.company);
const sub = () => document.querySelector("#sub").textContent;

let server, app;

/* Loads the page with its dialogs answered: every confirm accepted, every alert recorded. */
async function boot(opts){
  app = await loadApp(server, opts);
  window.confirm = vi.fn(() => true);
  window.alert = vi.fn();
}

beforeEach(async () => {
  server = fakeServer({
    "data.json": JSON.stringify(MAIN),
    "data.fellowship.json": JSON.stringify(FELLOWSHIP)
  });
  await boot();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */

describe("importing a file", () => {
  it("shows the imported rows in place of data/data.json", async () => {
    await importFile(app, "data.fellowship.json", FELLOWSHIP);

    expect(companies(app)).toEqual(["Fellow A", "Fellow B"]);
    expect(sub()).toContain("data/data.fellowship.json");
  });

  it("leaves data/data.json on disk exactly as it was", async () => {
    await importFile(app, "data.fellowship.json", FELLOWSHIP);

    expect(puts(server)).toEqual([]);
    expect(server.files["data.json"]).toBe(JSON.stringify(MAIN));
  });

  it("leaves the browser's copy of data/data.json alone", async () => {
    const before = localStorage.getItem(LS_KEY);

    await importFile(app, "data.fellowship.json", FELLOWSHIP);

    expect(localStorage.getItem(LS_KEY)).toBe(before);
  });
});

describe("editing an imported dataset", () => {
  it("writes nothing until Save, and says there are unsaved changes", async () => {
    await importFile(app, "data.fellowship.json", FELLOWSHIP);
    vi.useFakeTimers();

    app.touch(app.state.applications[0]);
    await vi.runAllTimersAsync();

    expect(puts(server)).toEqual([]);
    expect(sub()).toContain("unsaved changes");
  });
});

describe("a card opened on an imported dataset", () => {
  it("leaves nothing to save when it is closed without an edit", async () => {
    await importFile(app, "data.fellowship.json", FELLOWSHIP);
    document.querySelector("#tbody tr").click();

    document.querySelector("#dDone").click();

    expect(sub()).toContain("nothing to save");
  });
});

describe("opening a linked file with Open", () => {
  /* A file picked in the browser's Open dialog: what it holds, and what was written back to it. */
  function pickedFile(name, data){
    const handle = { name, written: [],
      getFile: async () => ({ text: async () => JSON.stringify(data) }),
      createWritable: async () => ({ write: async json => { handle.written.push(json); }, close: async () => {} }) };
    return handle;
  }
  const LINKED = doc("Linked A");
  let handle;

  beforeEach(async () => {
    handle = pickedFile("linked.json", LINKED);
    await boot({ before: w => { w.showOpenFilePicker = vi.fn(async () => [handle]); } });   // read once, when the app loads
  });

  it("saves an edit still waiting for its debounce to data/data.json before switching", async () => {
    app.state.applications[0].company = "Acme (edited)";
    app.touch(app.state.applications[0]);

    await press("#btnOpen");

    expect(JSON.parse(server.files["data.json"]).applications[0].company).toBe("Acme (edited)");
  });

  it("keeps an imported dataset with unsaved changes when the discard is declined", async () => {
    await importFile(app, "data.fellowship.json", FELLOWSHIP);
    app.touch(app.state.applications[0]);
    await vi.waitFor(() => expect(sub()).toContain("unsaved changes"));
    window.confirm = vi.fn(() => false);

    await press("#btnOpen");

    expect([app.mode, companies(app)]).toEqual(["dataset", ["Fellow A", "Fellow B"]]);
  });
});

describe("saving an imported dataset", () => {
  it("asks first, naming the imported file as the target", async () => {
    await importFile(app, "data.fellowship.json", FELLOWSHIP);

    await press("#btnSave");

    expect(window.confirm).toHaveBeenCalledWith("Save 2 applications to data/data.fellowship.json?");
  });

  it("writes the rows on screen to the imported file and not to data/data.json", async () => {
    await importFile(app, "data.fellowship.json", FELLOWSHIP);
    app.state.applications[0].company = "Fellow A (edited)";

    await press("#btnSave");
    await vi.waitFor(() => expect(puts(server)).toHaveLength(1));

    expect(puts(server)[0].path).toBe("data/data.fellowship.json");
    expect(JSON.parse(server.files["data.fellowship.json"]).applications.map(a => a.company))
      .toEqual(["Fellow A (edited)", "Fellow B"]);
    expect(server.files["data.json"]).toBe(JSON.stringify(MAIN));
  });

  it("writes nothing when the prompt is declined", async () => {
    await importFile(app, "data.fellowship.json", FELLOWSHIP);
    window.confirm = vi.fn(() => false);

    await press("#btnSave");

    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(puts(server)).toEqual([]);
  });

  it("creates the file under data/ when it is not there yet", async () => {
    await importFile(app, "other.json", FELLOWSHIP);

    await press("#btnSave");
    await vi.waitFor(() => expect(server.files["other.json"]).toBeDefined());

    expect(window.confirm).toHaveBeenCalledWith("Save 2 applications to data/other.json?");
    expect(JSON.parse(server.files["other.json"]).applications).toHaveLength(2);
  });
});

describe("a dataset file changed on disk while it was open", () => {
  beforeEach(async () => {
    await importFile(app, "data.fellowship.json", FELLOWSHIP);
    server.files["data.fellowship.json"] = JSON.stringify(doc("Someone else's edit"));
  });

  it("is kept when the overwrite is declined", async () => {
    window.confirm = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);

    await press("#btnSave");
    await vi.waitFor(() => expect(window.confirm).toHaveBeenCalledTimes(2));

    expect(window.confirm).toHaveBeenLastCalledWith(
      "data/data.fellowship.json has changed on disk since you opened it. Overwrite it anyway?");
    expect(JSON.parse(server.files["data.fellowship.json"]).applications.map(a => a.company))
      .toEqual(["Someone else's edit"]);
  });

  it("is replaced when the overwrite is accepted", async () => {
    await press("#btnSave");
    await vi.waitFor(() => expect(puts(server)).toHaveLength(2));

    expect(JSON.parse(server.files["data.fellowship.json"]).applications.map(a => a.company))
      .toEqual(["Fellow A", "Fellow B"]);
  });
});

describe("other actions on an imported dataset", () => {
  it("exports under the imported file's name", async () => {
    await importFile(app, "data.fellowship.json", FELLOWSHIP);
    window.URL.createObjectURL = vi.fn(() => "blob:x");
    window.URL.revokeObjectURL = vi.fn();
    let downloaded = null;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function(){ downloaded = this.download; });

    document.querySelector("#btnExport").click();

    expect(downloaded).toMatch(/^data\.fellowship-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it("sends the imported rows to Notes", async () => {
    await importFile(app, "data.fellowship.json", FELLOWSHIP);

    await press("#btnNote");

    const note = JSON.parse(server.requests.find(r => r.path === "api/note").body);
    const companyCol = note.columns.indexOf("Company");
    expect(note.rows.map(r => r[companyCol]).sort()).toEqual(["Fellow A", "Fellow B"]);
  });
});
