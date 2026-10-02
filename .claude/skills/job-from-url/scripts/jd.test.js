/**
 * Unit tests for how jd.js names the file it writes. The tracker page finds a
 * row's file by deriving the same name from the row, so the name has to come
 * from the row when one is given, and --name has to come out as a clean slug.
 * The header lists the fields it is given, in FIELDS order; which fields those
 * are - only what apply.js would accept - is resolveFields', in lib.test.js.
 */

import { describe, expect, it } from "vitest";
import { fileSlug, headerLines } from "./jd.js";

const POSTING = { company: "Acme Corp.", roleTitle: "Sr. Engineer" };
const ROW = { company: "Acme", roleTitle: "Senior Engineer" };

describe("fileSlug", () => {
  it("names the file from the tracker row when there is one", () => {
    expect(fileSlug(null, ROW, POSTING)).toBe("acme-senior-engineer");
  });

  it("names the file from the posting when there is no row", () => {
    expect(fileSlug(null, null, POSTING)).toBe("acme-corp-sr-engineer");
  });

  it("slugs --name without leaving a trailing hyphen", () => {
    expect(fileSlug("Foo Bar!", ROW, POSTING)).toBe("foo-bar");
  });

  it("is empty when the row has neither a company nor a role", () => {
    expect(fileSlug(null, { company: "", roleTitle: "" }, POSTING)).toBe("");
  });
});

describe("headerLines", () => {
  it("lists the fields in table order with their labels, without company type", () => {
    const fields = { company: "Acme", companyType: "Startup", postedRange: { min: 150000, max: 180000 } };

    expect(headerLines({ trusted: { jobLink: "https://acme.com/jobs/1" } }, fields)).toEqual([
      "- **Company:** Acme",
      "- **Posted range:** $150,000 - $180,000",
      "- **Job link:** https://acme.com/jobs/1"
    ]);
  });
});
