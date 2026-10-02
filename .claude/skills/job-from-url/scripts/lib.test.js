/**
 * Unit tests for resolveFields in lib.js: which of a posting's fields reach
 * the row (apply.js) and the JD file's header (jd.js). Two sources feed it -
 * the markup extract.js read, and the prose the sandboxed reader read - and
 * only values that pass FIELDS' checks get through, the markup winning.
 */

import { describe, expect, it } from "vitest";
import { resolveFields } from "./lib.js";

describe("resolveFields", () => {
  it("leaves out a salary range that is not an annual salary", () => {
    const marked = { company: "Acme", postedRange: { min: 50, max: 60 } };

    expect(resolveFields(marked, {}).accepted).toEqual({ company: "Acme" });
  });

  it("takes the reader's value when the markup's fails its check", () => {
    const marked = { companyWebsite: "https://boards.greenhouse.io/acme" };

    expect(resolveFields(marked, { companyWebsite: "https://acme.com/about" }).accepted)
      .toEqual({ companyWebsite: "https://acme.com" });
  });

  it("keeps the markup's value over the reader's when both pass", () => {
    expect(resolveFields({ company: "Acme" }, { company: "Acme Corp" }).accepted).toEqual({ company: "Acme" });
  });

  it("says a value came from the reader only when the markup did not supply it", () => {
    expect(resolveFields({ company: "Acme" }, { company: "Acme Corp", industry: "Logistics" }).from)
      .toEqual({ company: null, industry: "read from the posting" });
  });

  it("refuses a field the user sets, naming why", () => {
    expect(resolveFields({ status: "Offer" }, {}).rejected).toEqual([["status", "yours to set"]]);
  });

  it("refuses a key that is no field at all, even one Object itself has", () => {
    expect(resolveFields({ constructor: "x" }, {}).rejected).toEqual([["constructor", "not a field a posting may fill in"]]);
  });

  it("does not report a rejection for a field the other source filled", () => {
    const marked = { companyWebsite: "https://boards.greenhouse.io/acme" };

    expect(resolveFields(marked, { companyWebsite: "https://acme.com" }).rejected).toEqual([]);
  });

  it("reports a field both sources got wrong once", () => {
    expect(resolveFields({ postedOn: "soon" }, { postedOn: "later" }).rejected).toEqual([["postedOn", "not a YYYY-MM-DD date"]]);
  });
});
