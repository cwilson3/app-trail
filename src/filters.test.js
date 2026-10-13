/**
 * Unit tests for the table filter.
 *
 * The app is loaded through test-support/loadIndexApp.js, into a page with no
 * server behind it, with a line added to its script that hands the filter
 * functions back out. Nothing in `index.html` changes for the tests' benefit.
 *
 * Scope is the filter module: which rows pass, what the option lists hold, what
 * is persisted, and what the table shows as a result. The popover's placement
 * and its behaviour across a real page load belong to the Playwright suite.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { loadApp as loadPage } from "./test-support/loadIndexApp.js";

/* The key the filter is persisted under - hard-coded rather than read from the
   app, because it is a promise to every browser that already has one stored. */
const STORAGE_KEY = "at-filter";

/* Handed out from inside the app's IIFE. `state` is reassigned during boot, so
   it crosses as an accessor rather than a value. */
const EXPORTS = `
window.__app = {
  get state(){ return state; }, set state(v){ state = v; },
  filters, FILTER_FIELDS, CLOSED_STATUSES, OPEN_STATUSES, STATUSES, INTEREST_LEVELS, NO_INTEREST, ROLE_STATUSES, WORK_SETTINGS,
  defaultFilters, loadFilters, saveFilters, setFilter,
  filterValue, passesFilter, filterOptions, activeFilterCount,
  normalize, renderTable, sorted, addApplication
};
`;

/* A fresh copy of the app with no server. `stored` seeds localStorage first,
   so the filter the app reads at start-up is the one under test. */
const loadApp = stored => loadPage(null, { exports: EXPORTS, stored: stored === undefined ? {} : { [STORAGE_KEY]: stored } });

/* Applications go through the app's own normalize(), so a fixture cannot drift
   into a shape the app would never hold. */
function seed(app, rows){
  app.state = app.normalize({ applications: rows });
  app.renderTable();
}

const shown = () => [...document.querySelectorAll("#tbody tr td.company")].map(td => td.textContent);
const rowCount = () => document.querySelectorAll("#tbody tr").length;
const text = sel => document.querySelector(sel).textContent;

let app;
beforeEach(async () => { app = await loadApp(); });

/* ------------------------------------------------------------------ */

describe("the default filter", () => {
  it("hides applications that are finished and shows the rest", () => {
    seed(app, [
      { company:"Live",     status:"Interview" },
      { company:"Gone",     status:"Rejected" },
      { company:"Won",      status:"Accepted" },
      { company:"Pulled",   status:"Ghosted", roleStatus:"Closed" },
      { company:"Quit",     status:"Withdrawn" },
      { company:"Silent",   status:"Ghosted" },
      { company:"Late",     status:"Missed" },
      { company:"Waiting",  status:"Applied - Awaiting Response" }
    ]);
    expect(shown().sort()).toEqual(["Live", "Waiting"]);
  });

  it("counts exactly the five closed-out statuses", () => {
    expect(app.CLOSED_STATUSES).toEqual(["Accepted","Rejected","Withdrawn","Ghosted","Missed"]);
    expect(app.OPEN_STATUSES).toEqual(
      ["Ready","Applied - Awaiting Response","Recruiter Screen","Phone Screen","Interview","Final","Offer","Negotiating"]);
    expect([...app.OPEN_STATUSES, ...app.CLOSED_STATUSES].sort()).toEqual([...app.STATUSES].sort());
  });

  it("carries a row saved under the old 'Applied' wording over to the rename", () => {
    const row = app.normalize({ applications:[{ status:"Applied" }] }).applications[0];
    expect(row.status).toBe("Applied - Awaiting Response");
    expect(app.passesFilter(row)).toBe(true);
  });

  it("passes every open status and no closed one", () => {
    for (const status of app.OPEN_STATUSES)
      expect(app.passesFilter(app.normalize({ applications:[{ status }] }).applications[0]), status).toBe(true);
    for (const status of app.CLOSED_STATUSES)
      expect(app.passesFilter(app.normalize({ applications:[{ status }] }).applications[0]), status).toBe(false);
  });

  it("restricts status only - any company, any interest", () => {
    expect(app.activeFilterCount()).toBe(1);
    expect(app.filters.company.size).toBe(0);
    expect(app.filters.interest.size).toBe(0);
  });
});

describe("how a row is matched", () => {
  beforeEach(() => {
    seed(app, [
      { company:"Globex",  status:"Applied - Awaiting Response",   interest:"High" },
      { company:"Globex",  status:"Interview", interest:"Low" },
      { company:"Initech",  status:"Applied - Awaiting Response",   interest:"High" },
      { company:"Initech",  status:"Rejected",  interest:"High" }
    ]);
  });

  it("treats an empty selection as no restriction", () => {
    app.setFilter("status", []);
    expect(rowCount()).toBe(4);
    expect(app.activeFilterCount()).toBe(0);
  });

  it("ORs the values within one field", () => {
    app.setFilter("status", ["Applied - Awaiting Response", "Rejected"]);
    expect(rowCount()).toBe(3);
  });

  it("ANDs the fields together", () => {
    app.setFilter("company", ["Initech"]);
    app.setFilter("interest", ["High"]);
    expect(rowCount()).toBe(1);            // the Initech/Rejected row is still out on status
    app.setFilter("status", []);
    expect(rowCount()).toBe(2);
  });

  it("shows nothing when the fields have no row in common", () => {
    app.setFilter("company", ["Globex"]);
    app.setFilter("interest", ["Moderate"]);
    expect(rowCount()).toBe(0);
  });

  it("keeps a saved value that no longer matches any row, rather than ignoring it", () => {
    app.setFilter("company", ["Vanished"]);
    expect(rowCount()).toBe(0);            // an empty table, not a filter that quietly gave up
    expect(app.activeFilterCount()).toBe(2);
  });
});

describe("blank values", () => {
  it("reads a missing interest as the 'none' option", () => {
    const [none, low] = app.normalize({ applications:[{}, { interest:"Low" }] }).applications;
    expect(app.filterValue(none, "interest")).toBe(app.NO_INTEREST);
    expect(app.filterValue(low, "interest")).toBe("Low");
  });

  it("hides un-rated rows when a level is selected, and finds them on their own option", () => {
    seed(app, [
      { company:"Rated",   status:"Applied - Awaiting Response", interest:"High" },
      { company:"Unrated", status:"Applied - Awaiting Response" }
    ]);
    app.setFilter("interest", ["High"]);
    expect(shown()).toEqual(["Rated"]);
    app.setFilter("interest", [app.NO_INTEREST]);
    expect(shown()).toEqual(["Unrated"]);
  });

  it("filters on a blank company like any other value", () => {
    seed(app, [{ company:"Globex", status:"Applied - Awaiting Response" }, { status:"Applied - Awaiting Response" }]);
    expect(app.filterValue(app.state.applications[1], "company")).toBe("");
    app.setFilter("company", [""]);
    expect(rowCount()).toBe(1);
    expect(text("#tbody tr td.company")).toBe("—");
  });
});

describe("the option lists", () => {
  beforeEach(() => {
    seed(app, [
      { company:"globex",   status:"Applied - Awaiting Response",  interest:"High" },
      { company:"Globex",   status:"Rejected", interest:"High" },
      { company:"Acme",   status:"Applied - Awaiting Response" },
      { company:"Acme",   status:"Offer",    interest:"Low" }
    ]);
  });

  it("lists companies once each, case-insensitively sorted, with row counts", () => {
    expect(app.filterOptions("company").map(o => [o.value, o.n]))
      .toEqual([["Acme", 2], ["globex", 1], ["Globex", 1]]);
  });

  it("lists every status in the app's order, including ones nothing uses", () => {
    const opts = app.filterOptions("status");
    expect(opts.map(o => o.value)).toEqual(app.STATUSES);
    expect(opts.find(o => o.value === "Applied - Awaiting Response").n).toBe(2);
    expect(opts.find(o => o.value === "Ghosted").n).toBe(0);
  });

  it("lists the three interest levels plus 'none', labelled with an em dash", () => {
    const opts = app.filterOptions("interest");
    expect(opts.map(o => o.value)).toEqual([...app.INTEREST_LEVELS, app.NO_INTEREST]);
    expect(opts.find(o => o.value === app.NO_INTEREST)).toMatchObject({ label:"—", n:1 });
  });

  it("counts every row, not just the rows the other filters let through", () => {
    app.setFilter("company", ["Acme"]);
    expect(app.filterOptions("status").find(o => o.value === "Rejected").n).toBe(1);
  });

  it("keeps a selected company that has left the data, so it can be unticked", () => {
    app.setFilter("company", ["Departed"]);
    const opt = app.filterOptions("company").find(o => o.value === "Departed");
    expect(opt).toMatchObject({ label:"Departed", n:0 });
  });
});

/* Panel helpers - each opens the panel first, so the boxes exist to read. */
const openPanel = () => { if (document.querySelector("#filterPanel").hidden) document.querySelector("#btnFilter").click(); };
const boxes = field => [...document.querySelectorAll(`input[data-field="${field}"]`)];
const ticked = field => boxes(field).filter(b => b.checked).map(b => b.value);
const groupButton = (attr, field) => document.querySelector(`#filterPanel button[data-${attr}="${field}"]`);

function tick(field, value, checked){
  const box = boxes(field).find(b => b.value === value);
  box.checked = checked;
  box.dispatchEvent(new Event("change", { bubbles:true }));
}

describe("ticking every value", () => {
  beforeEach(() => {
    seed(app, [
      { company:"Globex", status:"Applied - Awaiting Response", interest:"High" },
      { company:"Initech", status:"Offer",   interest:"Low" }
    ]);
    openPanel();
  });

  it("keeps every box ticked once the last one is ticked", () => {
    for (const level of app.INTEREST_LEVELS) tick("interest", level, true);
    tick("interest", app.NO_INTEREST, true);

    expect(ticked("interest")).toEqual([...app.INTEREST_LEVELS, app.NO_INTEREST]);
    expect(app.activeFilterCount()).toBe(1);                               // the default status filter, alone
  });

  it("so a value that appears later is not silently excluded", () => {
    for (const value of app.STATUSES) tick("status", value, true);

    seed(app, [{ company:"New", status:"Ghosted" }]);

    expect(shown()).toEqual(["New"]);
  });

  it("unticking one value leaves the rest as an ordinary selection", () => {
    tick("status", "Ready", false);

    expect(app.filters.status.size).toBe(app.OPEN_STATUSES.length - 1);
    expect(app.filters.status.has("Ready")).toBe(false);
  });
});

describe("a field's All and None buttons", () => {
  beforeEach(() => {
    seed(app, [
      { company:"Globex",  status:"Interview", interest:"High" },
      { company:"Initech", status:"Rejected",  interest:"Low" }
    ]);
    openPanel();
  });

  it("offers All and None in place of Any", () => {
    const labels = [...document.querySelectorAll('#filterGroups section[data-field="status"] .fgroup-head button')]
      .map(b => b.textContent);

    expect(labels).toEqual(["All", "None"]);
  });

  it("ticks every box in the field when All is clicked", () => {
    groupButton("all", "status").click();

    expect(ticked("status")).toEqual(app.STATUSES);
  });

  it("shows every row and stops counting the field once All is clicked", () => {
    groupButton("all", "status").click();

    expect(shown().sort()).toEqual(["Globex", "Initech"]);
    expect(app.activeFilterCount()).toBe(0);
  });

  it("leaves the other fields alone when All is clicked", () => {
    app.setFilter("interest", ["High"]);

    groupButton("all", "status").click();

    expect(ticked("interest")).toEqual(["High"]);
    expect(shown()).toEqual(["Globex"]);
  });

  it("unticks every box in the field when None is clicked", () => {
    groupButton("all", "company").click();

    groupButton("clear", "company").click();

    expect(ticked("company")).toEqual([]);
  });

  it("unticking one box after All ticks off only that value", () => {
    groupButton("all", "status").click();

    tick("status", "Rejected", false);

    expect(ticked("status")).toEqual(app.STATUSES.filter(s => s !== "Rejected"));
    expect(shown()).toEqual(["Globex"]);
  });

  it("disables All when every box is ticked and None when none is", () => {
    groupButton("all", "interest").click();
    expect([groupButton("all", "interest").disabled, groupButton("clear", "interest").disabled]).toEqual([true, false]);

    groupButton("clear", "interest").click();

    expect([groupButton("all", "interest").disabled, groupButton("clear", "interest").disabled]).toEqual([false, true]);
  });

  it("remembers All between visits", async () => {
    groupButton("all", "company").click();
    const stored = localStorage.getItem(STORAGE_KEY);

    app = await loadApp(stored);
    seed(app, [{ company:"Later", status:"Interview" }]);
    openPanel();

    expect(ticked("company")).toEqual(["Later"]);
  });
});

describe("the Role Status filter", () => {
  beforeEach(() => {
    seed(app, [
      { company:"Globex",  status:"Interview", roleStatus:"Live" },
      { company:"Initech", status:"Interview", roleStatus:"Filled" },
      { company:"Acme",    status:"Interview" }
    ]);
    openPanel();
  });

  it("lists every role status in the app's order, with row counts", () => {
    expect(app.filterOptions("roleStatus").map(o => [o.value, o.n]))
      .toEqual([["Unknown", 1], ["Live", 1], ["Reposted", 0], ["Filled", 1], ["Closed", 0], ["Removed", 0]]);
  });

  it("shows only the rows whose role status is ticked", () => {
    tick("roleStatus", "Live", true);
    tick("roleStatus", "Unknown", true);

    expect(shown().sort()).toEqual(["Acme", "Globex"]);
  });

  it("restricts nothing by default", () => {
    expect(ticked("roleStatus")).toEqual([]);
    expect(shown().sort()).toEqual(["Acme", "Globex", "Initech"]);
  });

  it("ticks every role status when All is clicked", () => {
    groupButton("all", "roleStatus").click();

    expect(ticked("roleStatus")).toEqual(app.ROLE_STATUSES);
  });

  it("unticks every role status when None is clicked", () => {
    tick("roleStatus", "Live", true);

    groupButton("clear", "roleStatus").click();

    expect(ticked("roleStatus")).toEqual([]);
    expect(shown().sort()).toEqual(["Acme", "Globex", "Initech"]);
  });
});

describe("the Work Setting filter", () => {
  beforeEach(() => {
    seed(app, [
      { company:"Globex",  status:"Interview", workSetting:"Remote" },
      { company:"Initech", status:"Interview", workSetting:"On-Site" },
      { company:"Acme",    status:"Interview" }
    ]);
    openPanel();
  });

  it("lists every work setting in the app's order plus a blank, with row counts", () => {
    expect(app.filterOptions("workSetting").map(o => [o.value, o.n]))
      .toEqual([["Remote", 1], ["Hybrid", 0], ["On-Site", 1], ["", 1]]);
  });

  it("labels the blank work setting with an em dash", () => {
    expect(app.filterOptions("workSetting").find(o => o.value === "").label).toBe("—");
  });

  it("shows only the rows whose work setting is ticked", () => {
    tick("workSetting", "Remote", true);
    tick("workSetting", "", true);

    expect(shown().sort()).toEqual(["Acme", "Globex"]);
  });

  it("restricts nothing by default", () => {
    expect(shown().sort()).toEqual(["Acme", "Globex", "Initech"]);
  });

  it("ticks every work setting, blank included, when All is clicked", () => {
    groupButton("all", "workSetting").click();

    expect(ticked("workSetting")).toEqual([...app.WORK_SETTINGS, ""]);
  });

  it("lets every row through again when None is clicked", () => {
    tick("workSetting", "Remote", true);

    groupButton("clear", "workSetting").click();

    expect(shown().sort()).toEqual(["Acme", "Globex", "Initech"]);
  });
});

describe("Clear all", () => {
  beforeEach(() => {
    seed(app, [
      { company:"Globex",  status:"Interview", interest:"High" },
      { company:"Initech", status:"Rejected",  interest:"Low" }
    ]);
    openPanel();
  });

  it("unticks every box in every field, including a field set to All", () => {
    groupButton("all", "company").click();
    app.setFilter("interest", ["High"]);

    document.querySelector("#btnFilterClear").click();

    expect(app.FILTER_FIELDS.map(f => ticked(f.key))).toEqual([[], [], [], [], []]);
    expect(shown().sort()).toEqual(["Globex", "Initech"]);
  });

  it("stays available while only All boxes are ticked", () => {
    for (const f of app.FILTER_FIELDS) groupButton("all", f.key).click();

    expect(document.querySelector("#btnFilterClear").disabled).toBe(false);
  });
});

describe("what is remembered between visits", () => {
  it("writes the five fields as plain arrays", async () => {
    app.setFilter("company", ["Globex"]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toEqual({
      company: ["Globex"],
      status: app.OPEN_STATUSES,
      interest: [],
      roleStatus: [],
      workSetting: [],
      all: []
    });
  });

  /* An older build knows nothing of All; an empty array is what it reads as
     "no restriction", which is what All means. */
  it("writes a field set to All as an empty array named in `all`", async () => {
    seed(app, [{ company:"Globex", status:"Interview" }]);
    openPanel();

    document.querySelector('button[data-all="status"]').click();

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    expect([stored.status, stored.all]).toEqual([[], ["status"]]);
  });

  it("restores a filter stored before Role Status existed as no role-status restriction", async () => {
    app = await loadApp(JSON.stringify({ company:[], status:["Offer"], interest:[] }));

    seed(app, [{ company:"Filled", status:"Offer", roleStatus:"Filled" }]);

    expect(shown()).toEqual(["Filled"]);
  });

  it("restores a filter stored before Work Setting existed as no work-setting restriction", async () => {
    app = await loadApp(JSON.stringify({ company:[], status:["Offer"], interest:[], roleStatus:[] }));

    seed(app, [{ company:"Onsite", status:"Offer", workSetting:"On-Site" }]);

    expect(shown()).toEqual(["Onsite"]);
  });

  it("starts from the default when nothing is stored", async () => {
    app = await loadApp();
    expect([...app.filters.status]).toEqual(app.OPEN_STATUSES);
  });

  it("restores what was stored", async () => {
    app = await loadApp(JSON.stringify({ company:["Initech"], status:["Offer"], interest:["High"] }));
    seed(app, [
      { company:"Initech", status:"Offer", interest:"High" },
      { company:"Initech", status:"Offer", interest:"Low" },
      { company:"Globex", status:"Offer", interest:"High" }
    ]);
    expect(rowCount()).toBe(1);
    expect(app.activeFilterCount()).toBe(3);
  });

  it("carries a stored filter over to a renamed status", async () => {
    app = await loadApp(JSON.stringify({ company:[], status:["Applied", "Offer"], interest:[] }));
    expect([...app.filters.status]).toEqual(["Applied - Awaiting Response", "Offer"]);
    seed(app, [
      { company:"Waiting", status:"Applied - Awaiting Response" },
      { company:"Hidden",  status:"Ready" }
    ]);
    expect(shown()).toEqual(["Waiting"]);
  });

  it("restores an empty filter as 'show everything', not as the default", async () => {
    app = await loadApp(JSON.stringify({ company:[], status:[], interest:[] }));
    seed(app, [{ company:"Gone", status:"Ghosted" }]);
    expect(rowCount()).toBe(1);
  });

  it("falls back to the default when the stored value is unreadable", async () => {
    app = await loadApp("{not json");
    expect([...app.filters.status]).toEqual(app.OPEN_STATUSES);
  });

  it("takes what it recognises out of a partial or junk-filled record", async () => {
    app = await loadApp(JSON.stringify({ status:["Offer"], interest:[1, null, "High", {}] }));
    expect([...app.filters.status]).toEqual(["Offer"]);
    expect([...app.filters.interest]).toEqual(["High"]);
    expect(app.filters.company.size).toBe(0);
  });
});

describe("the table under a filter", () => {
  beforeEach(() => seed(app, [
    { company:"Acme",  status:"Applied - Awaiting Response",  interest:"High" },
    { company:"Beta",  status:"Rejected", interest:"High" },
    { company:"Cosmo", status:"Offer",    interest:"Low" }
  ]));

  it("renders only the rows that pass", () => {
    expect(shown()).toEqual(["Acme", "Cosmo"]);
  });

  it("numbers the visible rows from one", () => {
    expect([...document.querySelectorAll("#tbody td.rownum")].map(td => td.textContent))
      .toEqual(["1", "2"]);
  });

  it("sorts within the filtered rows", () => {
    document.querySelector('#headRow th[data-key="company"]').click();   // company, descending
    expect(shown()).toEqual(["Cosmo", "Acme"]);
  });

  it("says how many of the total are showing", () => {
    expect(text("#sub")).toContain("2 of 3 applications");
    app.setFilter("status", []);
    expect(text("#sub")).toContain("3 applications");
    expect(text("#sub")).not.toContain("of");
  });

  it("badges the button with the number of fields narrowing the table", () => {
    expect(text("#filterCount")).toBe("1");
    app.setFilter("company", ["Acme"]);
    expect(text("#filterCount")).toBe("2");
    expect(document.querySelector("#filterCount").hidden).toBe(false);
    app.setFilter("company", []);
    app.setFilter("status", []);
    expect(document.querySelector("#filterCount").hidden).toBe(true);
  });
});

describe("when nothing is on screen", () => {
  it("distinguishes a filtered-out table from an empty one", () => {
    seed(app, [{ company:"Gone", status:"Ghosted" }]);
    expect(rowCount()).toBe(0);
    expect(text("#emptyTitle")).toBe("Nothing matches your filters");
    expect(text("#emptyText")).toContain("All 1 applications are hidden");
    expect(document.querySelector("#btnEmptyFilter").hidden).toBe(false);
    expect(document.querySelector("#btnAdd2").hidden).toBe(true);
  });

  it("offers the first application when there is no data at all", () => {
    seed(app, []);
    expect(text("#emptyTitle")).toBe("No applications yet");
    expect(document.querySelector("#btnAdd2").hidden).toBe(false);
    expect(document.querySelector("#btnEmptyFilter").hidden).toBe(true);
  });

  it("clears every filter from the empty state", () => {
    seed(app, [{ company:"Gone", status:"Ghosted" }]);
    document.querySelector("#btnEmptyFilter").click();
    expect(app.activeFilterCount()).toBe(0);
    expect(shown()).toEqual(["Gone"]);
  });
});

describe("adding an application while filtering", () => {
  it("clears the filters that would have hidden the new blank row", () => {
    seed(app, [{ company:"Globex", status:"Applied - Awaiting Response" }]);
    app.setFilter("company", ["Globex"]);
    app.addApplication();
    expect(app.filters.company.size).toBe(0);
    expect(rowCount()).toBe(2);
    expect(text("#toast")).toBe("Filters cleared to show the new application");
  });

  it("leaves a filter the new row already satisfies alone", () => {
    seed(app, [{ company:"Globex", status:"Applied - Awaiting Response" }]);
    app.setFilter("status", ["Ready", "Applied - Awaiting Response"]);            // a blank row starts at Ready
    app.addApplication();
    expect([...app.filters.status]).toEqual(["Ready", "Applied - Awaiting Response"]);
    expect(rowCount()).toBe(2);
  });
});
