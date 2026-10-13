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

/* The role's status is no longer a section of the card: each posting holds
   its own, and the table's Posting Status column reads the one applied for. */
describe("Posting Status on the detail card and in the table", () => {
  async function openCard(row){
    const app = await loadApp(null, { exports: CARD_EXPORTS });
    app.state = app.normalize({ applications: [row] });
    app.renderTable();
    app.openDetail(app.state.applications[0]);
    return app;
  }

  const sections = () => [...document.querySelectorAll(".card-body .sec h3")].map(h => h.textContent.trim());
  const postingField = (key, gi) => document.querySelector('#dPostings [data-bind="' + key + '"][data-post="' + gi + '"]');
  const tableCell = () => {
    const col = [...document.querySelectorAll("#headRow th")].findIndex(th => th.dataset.key === "roleStatus");
    return document.querySelectorAll("#tbody tr")[0].children[col];
  };

  const ROW = { id:"a1", company:"Acme", roleTitle:"Staff Engineer", status:"Interview",
                postings:[{ board:"LinkedIn", status:"Live" }, { board:"Company Board", status:"Filled", applied:true }] };

  it("no longer gives the role a section of its own", async () => {
    await openCard(ROW);

    expect(sections()).not.toContain("Posting Status");
  });

  it("shows each posting's own status", async () => {
    await openCard(ROW);

    expect([postingField("status", 0).value, postingField("status", 1).value]).toEqual(["Live", "Filled"]);
  });

  it("offers every posting status the app knows, and no application status", async () => {
    await openCard(ROW);

    expect([...postingField("status", 0).options].map(o => o.value))
      .toEqual(["Unknown", "Live", "Reposted", "Filled", "Closed", "Removed"]);
  });

  it("shows the application's own status apart from it, unchanged", async () => {
    await openCard(ROW);

    expect(document.querySelector('.card-body [data-bind="status"]:not([data-post])').value).toBe("Interview");
  });

  it("shows the posting applied for's status in the table", async () => {
    await openCard(ROW);

    expect(tableCell().textContent).toBe("Filled");
  });

  it("shows Unknown in the table when no posting is marked applied for", async () => {
    await openCard({ id:"a1", company:"Acme", postings:[{ board:"LinkedIn", status:"Live" }] });

    expect(tableCell().textContent).toBe("Unknown");
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
    { id:"a3", company:"Acme",   roleTitle:"Platform Lead",      status:"Offer",     lastUpdate:"2026-10-02",
      postings:[{ board:"LinkedIn", status:"Live" }, { board:"Company Board", status:"Filled", applied:true }] },
    { id:"a4", company:"Globex", roleTitle:"Designer",           status:"Phone Screen", lastUpdate:"2026-08-11" }
  ];

  it("heads its columns with the role title, the posting status, the status and the last update", async () => {
    await openCard(ACME_AND_GLOBEX, "Staff Engineer");

    expect(headings()).toEqual(["Role Title", "Posting Status", "Status", "Last Update"]);
  });

  it("shows each role's posting status as the table does - the posting applied for, else Unknown", async () => {
    await openCard(ACME_AND_GLOBEX, "Staff Engineer");

    expect(listed().map(r => [r[0], r[1]])).toEqual([["Platform Lead", "Filled"], ["Developer Advocate", "Unknown"]]);
  });

  it("lists only the company's other roles, newest update first", async () => {
    await openCard(ACME_AND_GLOBEX, "Staff Engineer");

    expect(listed()).toEqual([
      ["Platform Lead", "Filled", "Offer", "2026-10-02"],
      ["Developer Advocate", "Unknown", "Ready", "2026-08-15"]
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
      .toEqual([[["Platform Lead", "Unknown", "Rejected", "2026-10-02"]], 1]);
  });

  it("shows a dash where a listed role has no title and no last update", async () => {
    await openCard([
      { id:"a1", company:"Acme", roleTitle:"Staff Engineer", status:"Interview", lastUpdate:"2026-09-01" },
      { id:"a2", company:"Acme", roleTitle:"",               status:"Ready",     lastUpdate:"" }
    ], "Staff Engineer");

    expect(listed()).toEqual([["\u2014", "Unknown", "Ready", "\u2014"]]);
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

    expect(listed()).toEqual([["Designer", "Unknown", "Phone Screen", "2026-08-11"]]);
  });
});

/* The card's title names the application: the company and the role title,
   whichever of them it has. */
describe("the detail card's title", () => {
  async function openCard(row){
    const app = await loadApp(null, { exports: CARD_EXPORTS });
    app.state = app.normalize({ applications: [Object.assign({ id:"a1" }, row)] });
    app.renderTable();
    app.openDetail(app.state.applications[0]);
    return app;
  }

  const title = () => $("#dTitle").textContent;

  it("shows the company and the role title", async () => {
    await openCard({ company:"Acme", roleTitle:"Staff Engineer" });

    expect(title()).toBe("Acme - Staff Engineer");
  });

  it("shows the company alone when the role has no title", async () => {
    await openCard({ company:"Acme", roleTitle:"  " });

    expect(title()).toBe("Acme");
  });

  it("shows the role title alone when the company has no name", async () => {
    await openCard({ company:"", roleTitle:"Staff Engineer" });

    expect(title()).toBe("Staff Engineer");
  });

  it("says New Application when it has neither", async () => {
    await openCard({ company:"", roleTitle:"" });

    expect(title()).toBe("New Application");
  });

  it("follows an edit to Role Title", async () => {
    await openCard({ company:"Acme", roleTitle:"Staff Engineer" });

    const input = $('#overlay [data-bind="roleTitle"]');
    input.value = "Platform Lead";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(title()).toBe("Acme - Platform Lead");
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
  const CAREERS = "https://careers.acme.com/jobs/123";

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
    const onChange = el.tagName === "SELECT" || ["checkbox", "date", "time", "datetime-local"].includes(el.type);
    el.dispatchEvent(new Event(onChange ? "change" : "input", { bubbles: true }));
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

  it("adds the Job Link as the company's posting when it is the company's own page", async () => {
    const app = await openCard({ jobLink: CAREERS, postings: [] });

    press('[data-act="add-posting"]');

    expect(postings(app).map(p => [p.board, p.link, p.found])).toEqual([["Company Board", CAREERS, true]]);
  });

  it("adds a blank posting when no Job Link is given", async () => {
    const app = await openCard({ postings: [] });

    press('[data-act="add-posting"]');

    expect(postings(app).map(p => [p.board, p.link, p.found])).toEqual([["Other", "", false]]);
  });

  it("sets the board to Company Board from a posting link on the company's site", async () => {
    const app = await openCard({ companyWebsite: "https://www.acme.com", postings: [{ board:"Other" }] });

    edit(control("link", 0), CAREERS);

    expect([postings(app)[0].board, control("board", 0).value]).toEqual(["Company Board", "Company Board"]);
  });

  it("leaves the board alone for a posting link on neither a board nor the company's site", async () => {
    const app = await openCard({ companyWebsite: "https://acme.com", postings: [{ board:"Other" }] });

    edit(control("link", 0), "https://dice.com/job/1");

    expect(postings(app)[0].board).toBe("Other");
  });

  describe("from the Applied Job Link", () => {
    const jobLink = () => $('[data-bind="jobLink"]:not([data-post])');
    function commit(value){
      const el = jobLink();
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }

    it("adds the company's posting when its own page is entered", async () => {
      const app = await openCard({ postings: [] });

      commit(CAREERS);

      expect(postings(app).map(p => [p.board, p.link])).toEqual([["Company Board", CAREERS]]);
    });

    it("does not mark it found when a board already turned the role up", async () => {
      const app = await openCard({ postings: [{ board:"LinkedIn", link: LINKEDIN, found: true }] });

      commit(CAREERS);

      expect(postings(app).map(p => [p.board, p.found])).toEqual([["LinkedIn", true], ["Company Board", false]]);
    });

    it("adds nothing while the link is still being typed", async () => {
      const app = await openCard({ postings: [] });
      const el = jobLink();

      el.value = CAREERS;
      el.dispatchEvent(new Event("input", { bubbles: true }));

      expect(postings(app)).toEqual([]);
    });

    it("adds nothing for a board's link", async () => {
      const app = await openCard({ postings: [] });

      commit(LINKEDIN);

      expect(postings(app)).toEqual([]);
    });

    it("adds nothing when a posting already holds the link", async () => {
      const app = await openCard({ postings: [{ board:"Company Board", link: CAREERS }] });

      commit(CAREERS);

      expect(postings(app).map(p => p.link)).toEqual([CAREERS]);
    });

    it("moves the company posting it made when the link is corrected, rather than adding another", async () => {
      const app = await openCard({ postings: [] });

      commit(CAREERS);
      commit("https://careers.acme.com/jobs/456");

      expect(postings(app).map(p => p.link)).toEqual(["https://careers.acme.com/jobs/456"]);
    });

    it("keeps a board's posting the link used to be", async () => {
      const app = await openCard({ jobLink: LINKEDIN, postings: [{ board:"LinkedIn", link: LINKEDIN, found: true }] });

      commit(CAREERS);

      expect(postings(app).map(p => p.board)).toEqual(["LinkedIn", "Company Board"]);
    });
  });

  describe("the company's logo", () => {
    const logo = gi => document.querySelectorAll("#dPostings .boardlogo")[gi];

    it("is the Company Website's icon, not the applicant system's the posting is on", async () => {
      await openCard({ companyWebsite: "https://www.acme.com/about", postings: [{ board:"Company Board", link: "https://boards.greenhouse.io/acme/jobs/1" }] });

      expect(logo(0).querySelector("img").getAttribute("src")).toBe("https://www.acme.com/favicon.ico");
    });

    it("is taken from the posting link when the company has no website given", async () => {
      await openCard({ postings: [{ board:"Company Board", link: CAREERS }] });

      expect(logo(0).querySelector("img").getAttribute("src")).toBe("https://careers.acme.com/favicon.ico");
    });

    it("appears once a posting link is entered", async () => {
      await openCard({ postings: [{ board:"Company Board" }] });

      edit(control("link", 0), CAREERS);

      expect(logo(0).querySelector("img").getAttribute("src")).toBe("https://careers.acme.com/favicon.ico");
    });

    it("falls back to the building when the icon will not load", async () => {
      await openCard({ postings: [{ board:"Company Board", link: CAREERS }] });

      logo(0).querySelector("img").dispatchEvent(new Event("error"));

      expect(logo(0).classList.contains("favicon")).toBe(false);
    });

    it("is not fetched for a job board's posting", async () => {
      await openCard({ postings: [{ board:"LinkedIn", link: LINKEDIN }] });

      expect(logo(0).querySelector("img")).toBeNull();
    });
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

  it("clears Applied For Here on the other postings when one is marked", async () => {
    const app = await openCard({ postings: [{ board:"LinkedIn", applied: true }, { board:"Company Board" }] });

    edit(control("applied", 1), true);

    expect([postings(app).map(p => p.applied), control("applied", 0).checked]).toEqual([[false, true], false]);
  });

  it("marks a posting added from the Job Link as the one applied for, when none is", async () => {
    const app = await openCard({ jobLink: CAREERS, postings: [{ board:"LinkedIn", link: LINKEDIN }] });

    press('[data-act="add-posting"]');

    expect(postings(app).map(p => p.applied)).toEqual([false, true]);
  });

  it("shows a posting's new status on its collapsed line as it is picked", async () => {
    await openCard({ postings: [{ board:"LinkedIn" }] });

    edit(control("status", 0), "Filled");

    expect($("#dPostings .posting-sum .pill").textContent).toBe("Filled");
  });

  it("edits when a posting was checked as a date and a time", async () => {
    await openCard({ postings: [{ board:"LinkedIn", checkedOn:"2026-09-28T14:05" }] });

    expect([control("checkedOn", 0).type, control("checkedOn", 0).value]).toEqual(["datetime-local", "2026-09-28T14:05"]);
  });

  it("keeps the date and time picked for when a posting was checked", async () => {
    const app = await openCard({ postings: [{ board:"LinkedIn" }] });

    edit(control("checkedOn", 0), "2026-10-12T09:30");

    expect(postings(app)[0].checkedOn).toBe("2026-10-12T09:30");
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

    it("shows the date and time the posting was last checked", async () => {
      await openCard({ postings: [{ board:"LinkedIn", checkedOn:"2026-09-28T14:05" }] });

      expect(summary(0).querySelector(".checked").textContent).toBe("Checked 2026-09-28 14:05");
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
