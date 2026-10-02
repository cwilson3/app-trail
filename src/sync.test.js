/**
 * Unit tests for how the page stays in step with data/data.json on the server:
 * what it renders from a loaded file, how it merges a change made on disk, and
 * what happens to edits when a save does not get through.
 *
 * The app is loaded through test-support/loadIndexApp.js. fetch is a fake
 * server.js, so what reached the file is read straight off `server.files`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LS_KEY, doc, fakeServer, loadApp, puts } from "./test-support/loadIndexApp.js";

const MAIN = doc("Acme", "Globex", "Initech");
/* What an import leaves on disk: the same rows, plus one more. */
const IMPORTED = doc("Acme", "Globex", "Initech", "Imported");

const companiesOnDisk = server =>
  JSON.parse(server.files["data.json"]).applications.map(a => a.company);
const sub = () => document.querySelector("#sub").textContent;

let server, app;

async function boot(data){
  server = fakeServer({ "data.json": JSON.stringify(data) });
  app = await loadApp(server);
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */

describe("a row id from a loaded file", () => {
  const HOSTILE_ID = 'x" onmouseover="alert(document.domain)';

  it("cannot add attributes to the table row", async () => {
    await boot({ version:1, savedAt:null, applications:[{ id: HOSTILE_ID, company:"Acme" }] });

    const row = document.querySelector("#tbody tr");

    expect(row.getAttributeNames()).toEqual(["data-id"]);
  });

  it("comes out the same on every load, so the row keeps its identity", async () => {
    const data = { version:1, savedAt:null, applications:[{ id: HOSTILE_ID, company:"Acme" }] };
    await boot(data);
    const first = app.state.applications[0].id;

    await boot(data);

    expect(app.state.applications[0].id).toBe(first);
  });

  it("is kept unchanged when it is an ordinary id", async () => {
    await boot(MAIN);

    expect(app.state.applications.map(a => a.id)).toEqual(["r0", "r1", "r2"]);
  });
});

describe("a change on disk that arrives while the user is typing", () => {
  let input;

  beforeEach(async () => {
    await boot(MAIN);
    document.querySelector("#tbody tr").click();                 // Acme: the table sorts by company
    input = document.querySelector('#overlay [data-bind="company"]');
    input.focus();
    server.files["data.json"] = JSON.stringify(IMPORTED);         // an import lands mid-edit

    input.value = "Acme (edited)";
    input.dispatchEvent(new Event("input", { bubbles:true }));
    await vi.waitFor(() => expect(sub()).toMatch(/waiting to merge|saved to/));
  });

  it("is not overwritten by the save that met it", () => {
    expect(server.files["data.json"]).toBe(JSON.stringify(IMPORTED));
  });

  it("gets the user's edit saved on top of it once they leave the field", async () => {
    input.blur();

    await vi.waitFor(() => expect(companiesOnDisk(server))
      .toEqual(["Acme (edited)", "Globex", "Initech", "Imported"]));
  });
});

describe("a change on disk to the row open in the card, while the user is not typing", () => {
  /* Acme with three rounds, of which the disk copy keeps two. */
  const round = id => ({ id, type:"Screen", status:"Scheduled", end:"Pending", notes:"", people:[] });
  const withRounds = (data, ...ids) => {
    const out = structuredClone(data);
    out.applications[0].rounds = ids.map(round);
    return out;
  };
  const rounds = () => [...document.querySelectorAll("#dRounds .round")];

  beforeEach(async () => {
    await boot(withRounds(MAIN, "a", "b", "c"));
    document.querySelector("#tbody tr").click();                 // Acme: the table sorts by company
    document.querySelector('#dRounds [data-act="toggle"][data-r="0"]').click();   // collapse round 1
    server.files["data.json"] = JSON.stringify(withRounds(MAIN, "a", "b"));

    app.touch(app.state.applications[1]);                         // a save of another row meets the change
    await vi.waitFor(() => expect(sub()).toMatch(/saved to/));
  });

  it("rebuilds the card with the rounds now on disk", () => {
    expect(rounds()).toHaveLength(2);
  });

  it("keeps a round the user collapsed collapsed", () => {
    expect(rounds().map(r => r.classList.contains("closed"))).toEqual([true, false]);
  });
});

describe("closing the card", () => {
  beforeEach(async () => {
    await boot(MAIN);
    document.querySelector("#tbody tr").click();
  });

  it("sends no save when nothing in it was changed", () => {
    document.querySelector("#dDone").click();

    expect(puts(server)).toEqual([]);
  });

  it("saves an edit straight away rather than waiting for the debounce", () => {
    const input = document.querySelector('#overlay [data-bind="company"]');
    input.value = "Acme (edited)";
    input.dispatchEvent(new Event("input", { bubbles:true }));

    document.querySelector("#dDone").click();

    expect(puts(server)).toHaveLength(1);
  });
});

describe("a save the server does not answer", () => {
  beforeEach(async () => {
    await boot(MAIN);
    vi.useFakeTimers();
    server.down = true;
    app.state.applications[0].company = "Acme (edited)";
    app.touch(app.state.applications[0]);
    await vi.advanceTimersByTimeAsync(500);                       // the debounced save, which fails
  });

  it("leaves the page syncing with the server", () => {
    expect(app.mode).toBe("server");
  });

  it("is reported as not saved when Save is pressed", async () => {
    await document.querySelector("#btnSave").onclick();

    expect(document.querySelector("#toast").textContent).toBe("Not saved to data/data.json yet — will keep trying");
  });

  it("is reported as saved when Save is pressed once the server is back", async () => {
    server.down = false;

    await document.querySelector("#btnSave").onclick();

    expect(document.querySelector("#toast").textContent).toBe("Saved to data/data.json");
  });

  it("is sent again once the server is back", async () => {
    server.down = false;

    await vi.advanceTimersByTimeAsync(2000);

    expect(companiesOnDisk(server)).toEqual(["Acme (edited)", "Globex", "Initech"]);
  });

  it("is sent after a reload, on top of whatever changed on disk meanwhile", async () => {
    vi.clearAllTimers();                                          // the old page is gone
    vi.useRealTimers();
    server.down = false;
    server.files["data.json"] = JSON.stringify(IMPORTED);

    app = await loadApp(server, { keepStorage: true });

    await vi.waitFor(() => expect(companiesOnDisk(server))
      .toEqual(["Acme (edited)", "Globex", "Initech", "Imported"]));
  });
});

describe("a pending-save record from another copy of the data", () => {
  it("is ignored on reload, leaving the server's copy as it is", async () => {
    await boot(MAIN);
    const stale = doc("Someone else's row");
    stale.savedAt = "2026-01-01T00:00:00.000Z";
    localStorage.setItem(LS_KEY, JSON.stringify(stale));
    localStorage.setItem(LS_KEY + ".pending", JSON.stringify({ savedAt: "2025-12-31T00:00:00.000Z", dirty: ["r0"], deleted: [] }));

    app = await loadApp(server, { keepStorage: true });

    expect([app.state.applications.map(a => a.company), puts(server)]).toEqual([["Acme", "Globex", "Initech"], []]);
  });
});
