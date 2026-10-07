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
  normalize, blankApp, sorted, OUTCOMES, setFilter,
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

describe("a new application", () => {
  it("starts at Ready, with one Screen round waiting to be scheduled", () => {
    const row = app.blankApp();

    expect([row.status, row.rounds.map(r => [r.type, r.status, r.end])]).toEqual(["Ready", [["Screen", "Scheduled", "Pending"]]]);
  });

  it("is born with a role id", () => {
    expect(app.blankApp().roleId).toMatch(/^[0-9a-z]+$/);
  });

  it("gets a role id of its own, not the one the row before it got", async () => {
    app = await loadApp(null, { exports: EXPORTS, before: countingIds });

    expect(app.blankApp().roleId).not.toBe(app.blankApp().roleId);
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
      "Accepted", "Rejected", "Ghosted", "Withdrawn", "Closed"
    ]);
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

  it("dress each swatch in Settings in its own theme's class", () => {
    const swatches = [...document.querySelectorAll("#themeCtl button")].map(b => [b.dataset.theme, b.querySelector(".sw").className]);

    expect(swatches).toEqual(ids.map(id => [id, "sw theme-" + id]));
  });
});
