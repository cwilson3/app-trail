/**
 * Unit tests for the app's model: what a loaded file is cleaned up into, what
 * a new application starts as, how each column sorts, and how the status and
 * theme tables reach everything built from them.
 *
 * The app is loaded through test-support/loadIndexApp.js, into a page with no
 * server behind it, with a line added to its script that hands these back out.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { loadApp } from "./test-support/loadIndexApp.js";

const EXPORTS = `
window.__app = {
  get state(){ return state; }, set state(v){ state = v; },
  normalize, blankApp, sorted, OUTCOMES, setFilter, STATUSES, ROLE_STATUSES,
  sortBy(key, dir){ sortKey = key; sortDir = dir; }
};
`;

const HTML = readFileSync(resolve(import.meta.dirname, "index.html"), "utf8");

let app;
beforeEach(async () => { app = await loadApp(null, { exports: EXPORTS }); });

/* Ids come from Math.random(), so a test that tells two of them apart needs it
   to stop being random. A counter in its place gives every id a value of its
   own - ++n / 36**8 is n itself once uid() has it in base 36 - without the test
   having to know how many ids the page mints, or in what order. */
const countingIds = window => { let n = 0; window.Math.random = () => ++n / 36 ** 8; };

const loaded = row => app.normalize({ applications: [row] }).applications[0];

describe("normalize", () => {
  it("drops a round that is not an object, keeping the rest", () => {
    expect(loaded({ rounds: [null, { type: "Final" }] }).rounds.map(r => r.type)).toEqual(["Final"]);
  });

  it("drops a person that is not an object, keeping the rest", () => {
    expect(loaded({ rounds: [{ people: ["x", { name: "Ada" }] }] }).rounds[0].people.map(p => p.name)).toEqual(["Ada"]);
  });

  it("falls back to Email for a contact type it does not know", () => {
    expect(loaded({ rounds: [{ people: [{ contactType: "Carrier pigeon" }] }] }).rounds[0].people[0].contactType).toBe("Email");
  });

  it("falls back to Pending for a person's end type it does not know", () => {
    expect(loaded({ rounds: [{ people: [{ endType: "Vanished" }] }] }).rounds[0].people[0].endType).toBe("Pending");
  });

  it("keeps a person's fields the app does not know about", () => {
    expect(loaded({ rounds: [{ people: [{ linkedin: "ada" }] }] }).rounds[0].people[0].linkedin).toBe("ada");
  });

  it("reads the old 'await' field as awaiting", () => {
    expect(loaded({ await: "2026-10-09" }).awaiting).toBe("2026-10-09");
  });

  it("treats a list holding something other than rounds as no rounds", () => {
    expect(loaded({ rounds: "soon" }).rounds).toEqual([]);
  });

  it("keeps the role id a row already carries, so the role stays the same role", () => {
    expect(loaded({ roleId: "smr10001" }).roleId).toBe("smr10001");
  });

  it("gives a row written before role ids existed one of its own", () => {
    expect(loaded({ company: "Acme" }).roleId).toMatch(/^[0-9a-z]+$/);
  });

  it("cuts a hand-edited role id down to word characters, the way it does an id", () => {
    expect(loaded({ roleId: "smr/100 01" }).roleId).toBe("smr_100_01");
  });
});

/* The role's status and the application's are two readings of two different
   things - the opening, and you - so the pair of them is what these cover:
   that each survives on its own, and that a row saved when the posting's state
   was kept in the application's field has it moved to the right one. */
describe("the role's status, apart from the application's", () => {
  it("starts a row nothing has checked yet at Unknown", () => {
    expect(loaded({ company: "Acme" }).roleStatus).toBe("Unknown");
  });

  it("keeps a role status a row already carries", () => {
    expect(loaded({ roleStatus: "Filled" }).roleStatus).toBe("Filled");
  });

  it("falls back to Unknown for a role status it does not know", () => {
    expect(loaded({ roleStatus: "Vanished" }).roleStatus).toBe("Unknown");
  });

  it("keeps when the role was last checked, and what it was checked against", () => {
    const row = loaded({ roleCheckedOn: "2026-10-08", roleStatusSource: "jobLink" });

    expect([row.roleCheckedOn, row.roleStatusSource]).toEqual(["2026-10-08", "jobLink"]);
  });

  it("lets a filled role hold an application that is still interviewing", () => {
    const row = loaded({ status: "Interview", roleStatus: "Filled" });

    expect([row.status, row.roleStatus]).toEqual(["Interview", "Filled"]);
  });

  it("no longer offers Closed as something an application can be", () => {
    expect(app.STATUSES).not.toContain("Closed");
  });

  it("offers it as something the role can be", () => {
    expect(app.ROLE_STATUSES).toContain("Closed");
  });
});

describe("a row saved when Closed was an application status", () => {
  it("has the posting's state lifted into the role's field", () => {
    expect(loaded({ status: "Closed" }).roleStatus).toBe("Closed");
  });

  it("has its own status sent to Ghosted, since no answer ever reached it", () => {
    expect(loaded({ status: "Closed" }).status).toBe("Ghosted");
  });

  it("does not overwrite a role status the row already carries", () => {
    expect(loaded({ status: "Closed", roleStatus: "Filled" }).roleStatus).toBe("Filled");
  });
});

describe("a new application", () => {
  it("starts at Ready, with one Screen round waiting to be scheduled", () => {
    const row = app.blankApp();

    expect([row.status, row.rounds.map(r => [r.type, r.status, r.end])]).toEqual(["Ready", [["Screen", "Scheduled", "Pending"]]]);
  });

  it("is born with a role id", () => {
    expect(app.blankApp().roleId).toMatch(/^[0-9a-z]+$/);
  });

  it("is born with a role nothing has checked yet", () => {
    const row = app.blankApp();

    expect([row.roleStatus, row.roleCheckedOn, row.roleStatusSource]).toEqual(["Unknown", "", ""]);
  });

  it("gets a role id of its own, not the one the row before it got", async () => {
    app = await loadApp(null, { exports: EXPORTS, before: countingIds });

    expect(app.blankApp().roleId).not.toBe(app.blankApp().roleId);
  });

  it("starts tracked on no job board", () => {
    expect(app.blankApp().postings).toEqual([]);
  });
});

/* Where a role was seen is a list of postings, one per board, kept apart from
   the Job Link you apply through. A row from before the list existed - or
   from the importer, which knows nothing of it - is given the posting its Job
   Link already is, and nothing more. */
describe("a row's postings", () => {
  const LINKEDIN = "https://www.linkedin.com/jobs/view/4012345678/";
  const CAREERS = "https://careers.acme.com/jobs/123";

  it("are given the posting a row's LinkedIn Job Link already is, as where the role was found", () => {
    const [posting] = loaded({ id: "a1", jobLink: LINKEDIN }).postings;

    expect([posting.board, posting.link, posting.found]).toEqual(["LinkedIn", LINKEDIN, true]);
  });

  it("recognise a TheLadders Job Link as that board's posting", () => {
    const row = loaded({ jobLink: "https://www.theladders.com/job/staff-engineer-acme_12345" });

    expect(row.postings.map(p => p.board)).toEqual(["TheLadders"]);
  });

  it("leave when a posting taken from the Job Link was first seen blank, rather than guess it", () => {
    expect(loaded({ jobLink: LINKEDIN }).postings[0].seenOn).toBe("");
  });

  it("are the same posting each time the row is loaded, not a new one", () => {
    const first = loaded({ id: "a1", jobLink: LINKEDIN }).postings[0].id;

    expect(loaded({ id: "a1", jobLink: LINKEDIN }).postings[0].id).toBe(first);
  });

  it("are none for a row whose Job Link is the company's own careers page", () => {
    expect(loaded({ jobLink: CAREERS }).postings).toEqual([]);
  });

  it("are never added to a row that already has the list, even an empty one", () => {
    expect(loaded({ jobLink: LINKEDIN, postings: [] }).postings).toEqual([]);
  });

  it("keep only the first of several marked found, since one board turned the role up", () => {
    const row = loaded({ postings: [{ board: "LinkedIn", found: true }, { board: "TheLadders", found: true }] });

    expect(row.postings.map(p => p.found)).toEqual([true, false]);
  });

  it("read a board the app does not know off the posting's link", () => {
    expect(loaded({ postings: [{ board: "Linked In", link: LINKEDIN }] }).postings[0].board).toBe("LinkedIn");
  });

  it("fall back to Other for a board neither named nor in the link", () => {
    expect(loaded({ postings: [{ board: "Dice", link: "https://dice.com/job/1" }] }).postings[0].board).toBe("Other");
  });

  it("keep a posting's fields the app does not know about, for the tool that wrote them", () => {
    expect(loaded({ postings: [{ board: "LinkedIn", trackerStage: "saved" }] }).postings[0].trackerStage).toBe("saved");
  });

  it("drop an entry that is not an object, keeping the rest", () => {
    expect(loaded({ postings: [null, "x", { board: "TheLadders" }] }).postings.map(p => p.board)).toEqual(["TheLadders"]);
  });
});

describe("sorting a column", () => {
  const order = () => app.sorted().map(a => a.company);

  beforeEach(() => {
    app.setFilter("status", []);
    app.state = app.normalize({ applications: [
      { company: "None", interest: "",         postedRange: {},                         rounds: [] },
      { company: "Low",  interest: "Low",      postedRange: { min: 90000, max: 100000 }, rounds: [{}, {}] },
      { company: "High", interest: "High",     postedRange: { max: 150000 },             rounds: [{}] },
      { company: "Mid",  interest: "Moderate", postedRange: { min: 120000 },             rounds: [{ end: "Rejected" }] }
    ] });
  });

  it("puts interest High before Moderate before Low, and unrated rows last", () => {
    app.sortBy("interest", 1);

    expect(order()).toEqual(["High", "Mid", "Low", "None"]);
  });

  it("keeps unrated rows last when the interest sort is reversed", () => {
    app.sortBy("interest", -1);

    expect(order()).toEqual(["Low", "Mid", "High", "None"]);
  });

  it("sorts a salary range by its low end, or its high end when that is all it has", () => {
    app.sortBy("postedRange", 1);

    expect(order()).toEqual(["Low", "Mid", "High", "None"]);
  });

  it("sorts by the round each application is on, those on none first", () => {
    app.sortBy("_round", 1);

    expect(order()).toEqual(["None", "Mid", "High", "Low"]);
  });
});

describe("the outcomes the flow view ends in", () => {
  it("lists the open ones, then the closed statuses good news first, then bad, then the ones nobody decided", () => {
    expect(app.OUTCOMES.map(o => o.label)).toEqual([
      "In progress", "Awaiting response", "Ready to apply",
      "Accepted", "Rejected", "Ghosted", "Withdrawn"
    ]);
  });

  it("dresses the one still waiting on a reply in a cool of its own, apart from the warm endings", () => {
    const waiting = app.OUTCOMES.find(o => o.label === "Awaiting response");

    expect(waiting.tone).toBe("cool");
  });

  it("dresses the one nobody decided in the warm tone rather than the one bad news wears", () => {
    const undecided = app.OUTCOMES.filter(o => o.label === "Withdrawn");

    expect(undecided.map(o => o.tone)).toEqual(["warm"]);
  });
});

describe("the themes", () => {
  const list = HTML.slice(HTML.indexOf("var THEMES = ["), HTML.indexOf("], DEFAULT_THEME"));
  const ids = [...list.matchAll(/\{ id:"(\w+)",/g)].map(m => m[1]);
  const block = id => (HTML.match(new RegExp("[\\s,]\\.theme-" + id + "\\{([^}]*)\\}")) || [])[1] || "";

  it("are listed in THEMES", () => {
    expect(ids).toHaveLength(13);
  });

  for (const id of ids) {
    it(`gives ${id} a stylesheet block with its own ground and accent`, () => {
      expect([/--bg:/.test(block(id)), /--accent:/.test(block(id))]).toEqual([true, true]);
    });
  }

  it("each carry the flow view's cool tone, which has no fallback to land on", () => {
    const missing = ids.filter(id => !/--cool-ink:/.test(block(id)));

    expect(missing).toEqual([]);
  });

  it("dress each swatch in Settings in its own theme's class", () => {
    const swatches = [...document.querySelectorAll("#themeCtl button")].map(b => [b.dataset.theme, b.querySelector(".sw").className]);

    expect(swatches).toEqual(ids.map(id => [id, "sw theme-" + id]));
  });
});
