/**
 * Unit tests for the flow view's two layouts: the graph each one builds out of
 * the same walk up the ladder, where the traditional layout's shared column of
 * endings is ordered, and what the toggle between them remembers.
 *
 * The app is loaded through test-support/loadIndexApp.js, into a page with no
 * server behind it, with a line added to its script that hands these back out.
 * How the diagram looks once it is drawn belongs to the Playwright suite.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { loadApp } from "./test-support/loadIndexApp.js";

const EXPORTS = `
window.__app = { pipelineGraph, layoutSankey };
`;

const $ = sel => document.querySelector(sel);

let app;
beforeEach(async () => { app = await loadApp(null, { exports: EXPORTS }); });

/* The three things stageReached() reads off an application: its status, the
   rounds that count, and whether it was ever applied to. */
const row = (status, rounds = [], appliedOn = "2026-01-02") => ({ status, rounds, appliedOn });
const round = type => ({ type, date: "2026-02-01" });

/* Everything the ladder itself draws; a node that is not one of these is one
   of the endings the two layouts place differently. */
const LADDER = ["Applications", "Applied", "Screen", "Interview", "Final", "Offer", "Not applied"];
const endings = g => g.nodes.filter(n => !LADDER.includes(n.label));
const named = (g, label) => g.nodes.filter(n => n.label === label);

/* The endings as they read down the column, once the diagram has been laid
   out at a width that leaves the ordering free of it. */
const downTheColumn = g => {
  app.layoutSankey(g, 960);
  return endings(g).sort((a, b) => a.y - b.y).map(n => n.label);
};

describe("the depth layout", () => {
  it("keeps one ending reached from two places as a block for each place", () => {
    const g = app.pipelineGraph([row("Closed"), row("Closed", [], "")], "depth");

    expect(named(g, "Closed").map(n => n.value)).toEqual([1, 1]);
  });

  it("puts an ending in the column after the stage it was reached from", () => {
    const g = app.pipelineGraph([row("Rejected"), row("Rejected", [round("Interview 1")])], "depth");

    expect(named(g, "Rejected").map(n => n.col)).toEqual([2, 4]);
  });
});

describe("the traditional layout", () => {
  it("gathers one ending reached from two places into a block carrying both", () => {
    const g = app.pipelineGraph([row("Closed"), row("Closed", [], "")], "traditional");

    expect(named(g, "Closed").map(n => n.value)).toEqual([2]);
  });

  it("puts every ending in one column past the end of the ladder", () => {
    const g = app.pipelineGraph(
      [row("Accepted"), row("Rejected"), row("Rejected", [round("Interview 1")]), row("Ready", [], "")], "traditional");
    const ladder = Math.max(...g.nodes.filter(n => LADDER.includes(n.label)).map(n => n.col));

    expect([...new Set(endings(g).map(n => n.col))]).toEqual([ladder + 1]);
  });

  it("leaves an application that was never applied to branching off at the start", () => {
    const g = app.pipelineGraph([row("Accepted"), row("Ready", [], "")], "traditional");

    expect(named(g, "Not applied")[0].col).toBe(1);
  });

  it("orders that column by where its ribbons come from, not by the endings' own order", () => {
    /* Ready to apply comes before Accepted in OUTCOMES, but it is fed by Not
       applied - the lowest block on the page - and Accepted by Offer, the
       highest, so the pull puts Accepted on top. */
    const g = app.pipelineGraph([row("Accepted"), row("Ready", [], "")], "traditional");

    expect(downTheColumn(g)).toEqual(["Accepted", "Ready to apply"]);
  });

  it("falls back to the endings' own order when two are pulled to the same place", () => {
    const g = app.pipelineGraph([row("Rejected"), row("Closed")], "traditional");

    expect(downTheColumn(g)).toEqual(["Rejected", "Closed"]);
  });
});

describe("the layout toggle", () => {
  it("remembers the layout it was switched to", () => {
    $("#flowCtl button[data-flow='traditional']").click();

    expect(localStorage.getItem("at-flow")).toBe("traditional");
  });

  it("comes back in the layout the last visit left", async () => {
    await loadApp(null, { exports: EXPORTS, stored: { "at-flow": "traditional" } });

    expect($("#flowCtl button[data-flow='traditional']").getAttribute("aria-pressed")).toBe("true");
  });

  it("says what the diagram is showing for the layout it is in", () => {
    $("#flowCtl button[data-flow='traditional']").click();

    expect($("#pipelineHint").textContent).toBe("How far each application has got, with every ending gathered on the right");
  });
});
