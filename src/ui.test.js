/**
 * Unit tests for the page's controls: the popovers, the icons drawn into the
 * markup, and how the table behind the detail card follows an edit.
 *
 * The app is loaded through test-support/loadIndexApp.js against a fake
 * server.js. Where a popover sits on screen, and how it behaves across a real
 * page load, belong to the Playwright suite.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { doc, fakeServer, loadApp } from "./test-support/loadIndexApp.js";

const $ = sel => document.querySelector(sel);
const key = name => new KeyboardEvent("keydown", { key: name, bubbles: true });

beforeEach(async () => {
  await loadApp(fakeServer({ "data.json": JSON.stringify(doc("Acme", "Globex")) }));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the icons in the markup", () => {
  it("are all drawn", () => {
    expect(document.querySelectorAll("i[data-icon]")).toHaveLength(0);
  });

  it("give Note an icon of its own rather than Export's", () => {
    expect($("#btnNote svg").outerHTML).not.toBe($("#btnExport svg").outerHTML);
  });
});

describe("the Actions menu", () => {
  it("closes on Escape, handing focus back to its button", () => {
    $("#btnActions").click();

    document.dispatchEvent(key("Escape"));

    expect([$("#actionsMenu").hidden, document.activeElement]).toEqual([true, $("#btnActions")]);
  });

  it("closes once one of its items is chosen", () => {
    $("#btnActions").click();

    $("#btnImport").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));

    expect($("#actionsMenu").hidden).toBe(true);
  });
});

describe("the filter panel", () => {
  it("draws a group for each field it filters on as it opens", () => {
    $("#btnFilter").click();

    expect([...document.querySelectorAll("#filterGroups .fgroup")].map(g => g.dataset.field)).toEqual(["company", "roleStatus", "interest", "workSetting", "status"]);
  });

  it("closes on a press outside it", () => {
    $("#btnFilter").click();

    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect($("#filterPanel").hidden).toBe(true);
  });
});

describe("the Settings panel", () => {
  it("closes on a press outside it", () => {
    $("#btnSettings").click();

    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect($("#settingsPanel").hidden).toBe(true);
  });

  it("stays open for a press inside it", () => {
    $("#btnSettings").click();

    $("#settingsPanel").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect($("#settingsPanel").hidden).toBe(false);
  });
});

/* Handed out from inside the app's IIFE. The card is opened directly, so the
   list under test does not depend on which rows the table is showing - the
   default filter hides the finished ones. `state` is reassigned during boot,
   so it crosses as an accessor. */
const CARD_EXPORTS = `
window.__app = {
  get state(){ return state; }, set state(v){ state = v; },
  normalize, renderTable, openDetail
};
`;

/* The role's status is on the card in a section of its own, apart from the
   application's. The split is the point: these check it is drawn as two
   separate controls holding two separate values, because a single Status
   field is exactly the confusion the second one was added to end. */
describe("the Posting Status section on the detail card", () => {
  async function openCard(row){
    const app = await loadApp(null, { exports: CARD_EXPORTS });
    app.state = app.normalize({ applications: [row] });
    app.renderTable();
    app.openDetail(app.state.applications[0]);
    return app;
  }

  const sections = () => [...document.querySelectorAll(".card-body .sec h3")].map(h => h.textContent.trim());
  const field = key => document.querySelector('.card-body [data-bind="' + key + '"]');

  const ROW = { id:"a1", company:"Acme", roleTitle:"Staff Engineer", status:"Interview",
                roleStatus:"Filled", roleCheckedOn:"2026-10-08", roleStatusSource:"jobLink" };

  it("gives the role a section of its own, between the application and the company", async () => {
    await openCard(ROW);

    expect(sections().slice(0, 3)).toEqual(["Application Details", "Posting Status", "Company Details"]);
  });

  it("shows the role's status", async () => {
    await openCard(ROW);

    expect(field("roleStatus").value).toBe("Filled");
  });

  it("shows the application's own status apart from it, unchanged", async () => {
    await openCard(ROW);

    expect(field("status").value).toBe("Interview");
  });

  it("shows when the role was last checked", async () => {
    await openCard(ROW);

    expect(field("roleCheckedOn").value).toBe("2026-10-08");
  });

  it("shows what it was checked against", async () => {
    await openCard(ROW);

    expect(field("roleStatusSource").value).toBe("jobLink");
  });

  it("offers every posting status the app knows, and no application status", async () => {
    await openCard(ROW);

    expect([...field("roleStatus").options].map(o => o.value))
      .toEqual(["Unknown", "Live", "Reposted", "Filled", "Closed", "Removed"]);
  });

  it("no longer offers Closed as something the application can be", async () => {
    await openCard(ROW);

    expect([...field("status").options].map(o => o.value)).not.toContain("Closed");
  });
});

describe("the Other Roles list on the detail card", () => {
  /* Rows go through the app's own normalize(), so a fixture cannot drift into
     a shape the app would never hold, and the card is opened on the row with
     the given role title. */
  async function openCard(rows, roleTitle){
    const app = await loadApp(null, { exports: CARD_EXPORTS });
    app.state = app.normalize({ applications: rows });
    app.renderTable();
    app.openDetail(app.state.applications.find(a => a.roleTitle === roleTitle));
    return app;
  }

  const headings = () => [...document.querySelectorAll("#dOtherRoles .ocell.head")].map(c => c.textContent);
  const note = () => {
    const p = document.querySelector("#dOtherRoles .none");
    return p && p.textContent;
  };
  /* The list is one grid of cells, as wide as its header row, the rows under
     the header following it in order. */
  function listed(){
    const cells = [...document.querySelectorAll("#dOtherRoles .ocell")];
    const width = headings().length;
    const rows = [];
    for (let i = width; width && i < cells.length; i += width) rows.push(cells.slice(i, i + width).map(c => c.textContent));
    return rows;
  }

  const ACME_AND_GLOBEX = [
    { id:"a1", company:"Acme",   roleTitle:"Staff Engineer",     status:"Interview", lastUpdate:"2026-09-01" },
    { id:"a2", company:"Acme",   roleTitle:"Developer Advocate", status:"Ready",     lastUpdate:"2026-08-15" },
    { id:"a3", company:"Acme",   roleTitle:"Platform Lead",      status:"Offer",     lastUpdate:"2026-10-02" },
    { id:"a4", company:"Globex", roleTitle:"Designer",           status:"Phone Screen", lastUpdate:"2026-08-11" }
  ];

  it("heads its columns with the role title, the status and the last update", async () => {
    await openCard(ACME_AND_GLOBEX, "Staff Engineer");

    expect(headings()).toEqual(["Role Title", "Status", "Last Update"]);
  });

  it("lists only the company's other roles, newest update first", async () => {
    await openCard(ACME_AND_GLOBEX, "Staff Engineer");

    expect(listed()).toEqual([
      ["Platform Lead", "Offer", "2026-10-02"],
      ["Developer Advocate", "Ready", "2026-08-15"]
    ]);
  });

  it("counts company names that differ only in case or spacing as one company", async () => {
    await openCard([
      { id:"a1", company:"Acme",   roleTitle:"Staff Engineer",     status:"Interview", lastUpdate:"2026-09-01" },
      { id:"a2", company:" acme ", roleTitle:"Developer Advocate", status:"Ready",     lastUpdate:"2026-08-15" },
      { id:"a3", company:"ACME",   roleTitle:"Platform Lead",      status:"Offer",     lastUpdate:"2026-10-02" }
    ], "Staff Engineer");

    expect(listed().map(r => r[0])).toEqual(["Platform Lead", "Developer Advocate"]);
  });

  it("lists a role the table's filter is hiding", async () => {
    await openCard([
      { id:"a1", company:"Acme", roleTitle:"Staff Engineer", status:"Interview", lastUpdate:"2026-09-01" },
      { id:"a2", company:"Acme", roleTitle:"Platform Lead",  status:"Rejected",  lastUpdate:"2026-10-02" }
    ], "Staff Engineer");

    expect([listed(), [...document.querySelectorAll("#tbody tr")].length])
      .toEqual([[["Platform Lead", "Rejected", "2026-10-02"]], 1]);
  });

  it("shows a dash where a listed role has no title and no last update", async () => {
    await openCard([
      { id:"a1", company:"Acme", roleTitle:"Staff Engineer", status:"Interview", lastUpdate:"2026-09-01" },
      { id:"a2", company:"Acme", roleTitle:"",               status:"Ready",     lastUpdate:"" }
    ], "Staff Engineer");

    expect(listed()).toEqual([["\u2014", "Ready", "\u2014"]]);
  });

  it("says there are none when the company holds only this role", async () => {
    await openCard(ACME_AND_GLOBEX, "Designer");

    expect([note(), listed()]).toEqual(["No other roles at Globex.", []]);
  });

  it("asks for a company name when the card has none", async () => {
    await openCard([{ id:"a1", company:"", roleTitle:"Staff Engineer", status:"Interview", lastUpdate:"2026-09-01" }],
      "Staff Engineer");

    expect(note()).toBe("Name the company to see its other roles.");
  });

  it("follows an edit to Company Name", async () => {
    await openCard(ACME_AND_GLOBEX, "Staff Engineer");

    const input = $('#overlay [data-bind="company"]');
    input.value = "Globex";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(listed()).toEqual([["Designer", "Phone Screen", "2026-08-11"]]);
  });
});

/* Notes sit in a sub-section of Application Details. How tall the box draws is
   pure CSS layout, which jsdom does not do, so it is not checked here. */
describe("the Notes box on the detail card", () => {
  const NOTES_EXPORTS = `
window.__app = {
  get state(){ return state; }, set state(v){ state = v; },
  normalize, renderTable, openDetail
};
`;

  async function openCard(row){
    const app = await loadApp(null, { exports: NOTES_EXPORTS });
    app.state = app.normalize({ applications: [Object.assign({ id:"a1", company:"Acme" }, row)] });
    app.renderTable();
    app.openDetail(app.state.applications[0]);
    return app;
  }

  const box = () => $('#dAppNotes textarea[data-bind="notes"]');
  const sectionTitles = () => [...document.querySelectorAll(".card-body .sec h3")];

  it("shows the saved notes", async () => {
    await openCard({ notes: "Spoke to Dana.\nFollow up Friday." });

    expect(box().value).toBe("Spoke to Dana.\nFollow up Friday.");
  });

  it("sits under Application Details, before the next section", async () => {
    await openCard({});
    const [details, next] = sectionTitles();          // 4: box follows, 2: box precedes

    const after = details.compareDocumentPosition(box()) & 4;
    const before = next.compareDocumentPosition(box()) & 2;

    expect([details.textContent, $("#dAppNotes h4").textContent, !!after, !!before])
      .toEqual(["Application Details", "Notes", true, true]);
  });

  it("saves what is typed onto the row", async () => {
    const app = await openCard({});

    box().value = "Referred by Sam";
    box().dispatchEvent(new Event("input", { bubbles: true }));

    expect(app.state.applications[0].notes).toBe("Referred by Sam");
  });

  it("loads a row saved before notes existed with empty notes", async () => {
    await openCard({});

    expect(box().value).toBe("");
  });
});

/* The boards a role was seen on sit under Application Details, apart from the
   Job Link. These drive the card the way a person does - a press, a keystroke
   - and read the result off the open row, which is what gets saved. */
describe("the Postings list on the detail card", () => {
  const LINKEDIN = "https://www.linkedin.com/jobs/view/4012345678/";
  const LADDERS = "https://www.theladders.com/job/staff-engineer-acme_12345";

  async function openCard(row){
    const app = await loadApp(null, { exports: CARD_EXPORTS });
    app.state = app.normalize({ applications: [Object.assign({ id:"a1", company:"Acme" }, row)] });
    app.renderTable();
    app.openDetail(app.state.applications[0]);
    return app;
  }

  const postings = app => app.state.applications[0].postings;
  const control = (key, gi) => $('#dPostings [data-bind="' + key + '"][data-post="' + gi + '"]');
  const press = sel => $("#dPostings " + sel).click();
  function edit(el, value){
    if (el.type === "checkbox") el.checked = value; else el.value = value;
    el.dispatchEvent(new Event(el.type === "checkbox" ? "change" : "input", { bubbles: true }));
  }

  it("shows each board the role is posted on", async () => {
    await openCard({ postings: [{ board:"LinkedIn" }, { board:"TheLadders" }] });

    expect([control("board", 0).value, control("board", 1).value]).toEqual(["LinkedIn", "TheLadders"]);
  });

  it("says when the role is tracked on no board", async () => {
    await openCard({ postings: [] });

    expect($("#dPostings .none").textContent).toBe("Not tracked on any job board yet.");
  });

  it("adds the Job Link as the posting when it is a board's and no posting holds it", async () => {
    const app = await openCard({ jobLink: LINKEDIN, postings: [] });

    press('[data-act="add-posting"]');

    expect(postings(app).map(p => [p.board, p.link, p.found, p.seenOn])).toEqual([["LinkedIn", LINKEDIN, true, ""]]);
  });

  it("adds a blank posting when the Job Link is the company's own page", async () => {
    const app = await openCard({ jobLink: "https://careers.acme.com/jobs/123", postings: [] });

    press('[data-act="add-posting"]');

    expect(postings(app).map(p => [p.board, p.link, p.found])).toEqual([["Other", "", false]]);
  });

  it("does not mark a posting from the Job Link found when another board already is", async () => {
    const app = await openCard({ jobLink: LINKEDIN, postings: [{ board:"TheLadders", link: LADDERS, found: true }] });

    press('[data-act="add-posting"]');

    expect(postings(app).map(p => p.found)).toEqual([true, false]);
  });

  it("sets the board from a posting link typed in", async () => {
    const app = await openCard({ postings: [{ board:"Other" }] });

    edit(control("link", 0), LADDERS);

    expect([postings(app)[0].board, control("board", 0).value]).toEqual(["TheLadders", "TheLadders"]);
  });

  it("clears Found Here on the other postings when one is marked", async () => {
    const app = await openCard({ postings: [{ board:"LinkedIn", found: true }, { board:"TheLadders" }] });

    edit(control("found", 1), true);

    expect([postings(app).map(p => p.found), control("found", 0).checked]).toEqual([[false, true], false]);
  });

  it("removes a posting", async () => {
    const app = await openCard({ postings: [{ board:"LinkedIn" }, { board:"TheLadders" }] });

    press('[data-act="del-posting"][data-post="0"]');

    expect(postings(app).map(p => p.board)).toEqual(["TheLadders"]);
  });

  it("opens the posting's own link, not the Job Link", async () => {
    await openCard({ jobLink: "https://careers.acme.com/jobs/123", postings: [{ board:"TheLadders", link: LADDERS }] });
    const open = vi.spyOn(window, "open").mockReturnValue(null);

    press('[data-act="open-link"][data-post="0"]');

    expect(open).toHaveBeenCalledWith(LADDERS, "_blank", "noopener");
  });

  describe("collapsed", () => {
    const cards = () => [...document.querySelectorAll("#dPostings .posting")];
    const summary = gi => cards()[gi].querySelector(".posting-sum");
    const toggle = gi => press('[data-act="toggle-posting"][data-post="' + gi + '"]');

    it("starts every posting collapsed when the card opens", async () => {
      await openCard({ postings: [{ board:"LinkedIn" }, { board:"TheLadders" }] });

      expect(cards().map(c => c.classList.contains("closed"))).toEqual([true, true]);
    });

    it("expands a posting when its chevron is pressed", async () => {
      await openCard({ postings: [{ board:"LinkedIn" }, { board:"TheLadders" }] });

      toggle(1);

      expect(cards().map(c => c.classList.contains("closed"))).toEqual([true, false]);
    });

    it("collapses it again on a second press", async () => {
      await openCard({ postings: [{ board:"LinkedIn" }] });

      toggle(0);
      toggle(0);

      expect(cards()[0].classList.contains("closed")).toBe(true);
    });

    it("tells a screen reader whether the posting is expanded", async () => {
      await openCard({ postings: [{ board:"LinkedIn" }] });

      toggle(0);

      expect(control("found", 0).closest(".posting").querySelector(".chev").getAttribute("aria-expanded")).toBe("true");
    });

    it("opens a newly added posting expanded, ready to fill in", async () => {
      await openCard({ postings: [{ board:"LinkedIn" }] });

      press('[data-act="add-posting"]');

      expect(cards().map(c => c.classList.contains("closed"))).toEqual([true, false]);
    });

    it("keeps a posting expanded when another is added", async () => {
      await openCard({ postings: [{ board:"LinkedIn" }] });
      toggle(0);

      press('[data-act="add-posting"]');

      expect(cards()[0].classList.contains("closed")).toBe(false);
    });

    it("shows each board's logo, named for a screen reader", async () => {
      await openCard({ postings: [{ board:"LinkedIn" }, { board:"TheLadders" }, { board:"Other" }] });

      expect([...document.querySelectorAll("#dPostings .boardlogo")].map(l => l.getAttribute("aria-label")))
        .toEqual(["LinkedIn", "TheLadders", "Other"]);
    });

    it("gives each board a logo of its own", async () => {
      await openCard({ postings: [{ board:"LinkedIn" }, { board:"TheLadders" }, { board:"Other" }] });

      expect(new Set([...document.querySelectorAll("#dPostings .boardlogo")].map(l => l.innerHTML)).size).toBe(3);
    });

    it("shows when the posting was last checked", async () => {
      await openCard({ postings: [{ board:"LinkedIn", checkedOn:"2026-09-28" }] });

      expect(summary(0).querySelector(".checked").textContent).toBe("Checked 2026-09-28");
    });

    it("says so when the posting has never been checked", async () => {
      await openCard({ postings: [{ board:"LinkedIn" }] });

      expect(summary(0).querySelector(".checked").textContent).toBe("Not checked");
    });

    it("copies the posting's link without expanding it", async () => {
      await openCard({ jobLink: "https://careers.acme.com/jobs/123", postings: [{ board:"TheLadders", link: LADDERS }] });
      const writeText = vi.fn().mockResolvedValue(undefined);         // the page's own window, thrown away after the test
      Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
      Object.defineProperty(window.navigator, "clipboard", { value: { writeText }, configurable: true });

      summary(0).querySelector('[data-act="copy-link"]').click();

      await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(LADDERS));
    });

    it("opens the posting's link in a new tab without expanding it", async () => {
      await openCard({ jobLink: "https://careers.acme.com/jobs/123", postings: [{ board:"TheLadders", link: LADDERS }] });
      const open = vi.spyOn(window, "open").mockReturnValue(null);

      summary(0).querySelector('[data-act="open-link"]').click();

      expect(open).toHaveBeenCalledWith(LADDERS, "_blank", "noopener");
    });

    it("disables copy and open while the posting has no link", async () => {
      await openCard({ postings: [{ board:"Other" }] });

      expect([...summary(0).querySelectorAll(".openbtn")].map(b => b.disabled)).toEqual([true, true]);
    });

    it("shows a link typed in the expanded posting once it is collapsed", async () => {
      await openCard({ postings: [{ board:"Other" }] });
      toggle(0);
      edit(control("link", 0), LADDERS);

      toggle(0);

      expect([...summary(0).querySelectorAll(".openbtn")].map(b => b.disabled)).toEqual([false, false]);
    });
  });
});

describe("the table behind the detail card", () => {
  const companies = () => [...document.querySelectorAll("#tbody td.company")].map(td => td.textContent);

  function typeCompany(value){
    const input = $('#overlay [data-bind="company"]');
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  beforeEach(() => {
    $("#tbody tr").click();                                       // Acme: the table sorts by company
    vi.useFakeTimers();
  });

  it("is left alone while the user is still typing", () => {
    typeCompany("Acme (edited)");

    expect(companies()).toEqual(["Acme", "Globex"]);
  });

  it("is redrawn once typing pauses", async () => {
    typeCompany("Acme (edited)");

    await vi.advanceTimersByTimeAsync(150);

    expect(companies()).toEqual(["Acme (edited)", "Globex"]);
  });

  it("is redrawn when the card closes, without waiting for the pause", async () => {
    typeCompany("Acme (edited)");

    $("#dDone").click();
    const shown = companies();
    await vi.waitFor(() => expect($("#sub").textContent).toContain("saved to"));   // the save closing sent

    expect(shown).toEqual(["Acme (edited)", "Globex"]);
  });
});
