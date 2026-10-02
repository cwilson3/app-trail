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

    expect([...document.querySelectorAll("#filterGroups .fgroup")].map(g => g.dataset.field)).toEqual(["company", "status", "interest"]);
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
