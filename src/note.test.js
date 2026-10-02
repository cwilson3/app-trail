/**
 * Unit tests for note.js - the table the Note button sends, and the note
 * written from it.
 *
 * Writing a real note needs osascript and Notes.app, and the whole request is
 * covered against a running server (with a stand-in for osascript) by the
 * Playwright suite. These pin what does not need either: the limits spec.yml
 * documents, and what a table is turned into.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { NOTE_LIMITS, isAutomationDenied, noteHtml, parseNotePayload } from "./note.js";

const SPEC = parse(readFileSync(resolve(import.meta.dirname, "..", "spec.yml"), "utf8"));
const REQUEST = SPEC.paths["/api/note"].post.requestBody.content["application/json"].schema.properties;

const table = (columns, rows = []) => JSON.stringify({ columns, rows });
const named = n => Array.from({ length: n }, (_, i) => "Column " + (i + 1));

describe("NOTE_LIMITS against spec.yml", () => {
  it("allows the columns spec.yml documents", () => {
    expect([NOTE_LIMITS.minColumns, NOTE_LIMITS.maxColumns]).toEqual([REQUEST.columns.minItems, REQUEST.columns.maxItems]);
  });

  it("allows the rows spec.yml documents", () => {
    expect(NOTE_LIMITS.maxRows).toBe(REQUEST.rows.maxItems);
  });
});

describe("parseNotePayload", () => {
  it("accepts the most columns allowed", () => {
    expect(parseNotePayload(table(named(NOTE_LIMITS.maxColumns))).columns).toHaveLength(NOTE_LIMITS.maxColumns);
  });

  it("refuses one column more than allowed", () => {
    expect(() => parseNotePayload(table(named(NOTE_LIMITS.maxColumns + 1)))).toThrow("Expected between 1 and 20 columns.");
  });

  it("refuses a table with no columns", () => {
    expect(() => parseNotePayload(table([]))).toThrow("Expected between 1 and 20 columns.");
  });

  it("refuses one row more than allowed", () => {
    const rows = Array.from({ length: NOTE_LIMITS.maxRows + 1 }, () => ["x"]);

    expect(() => parseNotePayload(table(["A"], rows))).toThrow("Expected at most 5000 rows.");
  });

  it("cuts a cell to the longest allowed", () => {
    const { rows } = parseNotePayload(table(["A"], [["x".repeat(NOTE_LIMITS.maxCell + 1)]]));

    expect(rows[0][0]).toHaveLength(NOTE_LIMITS.maxCell);
  });

  it("pads a short row and trims a long one to the number of columns", () => {
    expect(parseNotePayload(table(["A", "B"], [["1"], ["1", "2", "3"]])).rows).toEqual([["1", ""], ["1", "2"]]);
  });
});

describe("noteHtml", () => {
  const AT = new Date("2026-10-01T12:00:00Z");

  it("leads with the title, which Notes takes as the note's name", () => {
    expect(noteHtml("Search", ["A"], [], AT).startsWith("<h1>Search</h1>")).toBe(true);
  });

  it("escapes markup in the title and the cells", () => {
    const html = noteHtml("<i>T</i>", ["A"], [['<script>"x"</script>']], AT);

    expect(html).not.toMatch(/<script>|<i>/);
  });
});

describe("isAutomationDenied", () => {
  it("recognises the error macOS gives when Notes may not be controlled", () => {
    expect(isAutomationDenied("execution error: Not authorized to send Apple events to Notes. (-1743)")).toBe(true);
  });

  it("does not take another osascript error for a refusal", () => {
    expect(isAutomationDenied("execution error: Notes got an error: AppleEvent timed out. (-1712)")).toBe(false);
  });
});
