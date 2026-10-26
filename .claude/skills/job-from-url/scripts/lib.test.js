/**
 * Unit tests for resolveFields in lib.js: which of a posting's fields reach
 * the row (apply.js) and the JD file's header (jd.js). Two sources feed it -
 * the markup extract.js read, and the prose the sandboxed reader read - and
 * only values that pass FIELDS' checks get through, the markup winning.
 *
 * Also framePosting, which cuts a known board's whole page - as flat text or
 * as the markdown its markup became - down to the posting for jd.js, and gives
 * up rather than guess when the layout differs; pageMarkup, which slims a
 * whole page before extract.js keeps it; textToMarkdown's handling of plain
 * lines; and canonicalizeSections' joining of back-to-back sections that come
 * out with the same name.
 */

import { describe, expect, it } from "vitest";
import { canonicalizeSections, framePosting, pageMarkup, resolveFields, textToMarkdown } from "./lib.js";

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

describe("framePosting", () => {
  const PAGE = [
    "Sign in", "Email or phone", "Save", "", "Report this job",
    "About the job", "Save the world, one test at a time.", "",
    "Show more", "Show less", "Seniority level", "Similar jobs", "Show more"
  ].join("\n");

  it("keeps only the lines between LinkedIn's Report this job and Show more", () => {
    expect(framePosting(PAGE, "LinkedIn")).toBe("About the job\nSave the world, one test at a time.");
  });

  it("stops at the job criteria when the posting has no Show more of its own", () => {
    const page = ["Report this job", "About the job", "Short.", "Seniority level", "Similar jobs", "Show more"].join("\n");

    expect(framePosting(page, "LinkedIn")).toBe("About the job\nShort.");
  });

  it("starts after LinkedIn's sign-in prompts when they follow Report this job", () => {
    const page = [
      "Report this job", "Use AI to assess how you fit", "Sign in to access AI-powered advices", "Email or phone",
      "New to LinkedIn? Join now", "By clicking Continue to join or sign in, you agree to LinkedIn's User Agreement.",
      "", "Sign in to tailor your resume", "Email or phone", "New to LinkedIn? Join now",
      "By clicking Continue to join or sign in, you agree to LinkedIn's User Agreement.",
      "", "About the job", "Build things.", "Show more"
    ].join("\n");

    expect(framePosting(page, "LinkedIn")).toBe("About the job\nBuild things.");
  });

  it("keeps a sign-in prompt that comes after the posting starts", () => {
    const page = [
      "Report this job", "About the job", "Build things.",
      "New to LinkedIn? Join now", "By clicking Continue to join or sign in, you agree.", "Show more"
    ].join("\n");

    expect(framePosting(page, "LinkedIn")).toBe(
      "About the job\nBuild things.\nNew to LinkedIn? Join now\nBy clicking Continue to join or sign in, you agree.");
  });

  it("finds the markers in the markdown a page's markup became", () => {
    const md = "- [Report this job](https://www.linkedin.com/report)\n\n## About the job\n\n- Build things.\n\n**Show more**";

    expect(framePosting(md, "LinkedIn")).toBe("## About the job\n\n- Build things.");
  });

  it("returns null for a board with no known frame", () => {
    expect(framePosting(PAGE, "Company Portal")).toBeNull();
  });

  it("returns null when the start marker is missing", () => {
    expect(framePosting("About the job\nShow more", "LinkedIn")).toBeNull();
  });

  it("returns null when no end marker follows the start", () => {
    expect(framePosting("Show more\nReport this job\nAbout the job", "LinkedIn")).toBeNull();
  });

  it("returns null when nothing sits between the markers", () => {
    expect(framePosting("Report this job\n\nShow more", "LinkedIn")).toBeNull();
  });
});

describe("pageMarkup", () => {
  it("drops the head, scripts, styles and comments and keeps the body's markup", () => {
    const html = "<html><head><title>T</title><style>p{}</style></head>" +
      "<body><!-- nav --><script>x()</script><ul><li>Build</li></ul></body></html>";

    expect(pageMarkup(html)).toBe("<html> <body> <ul><li>Build</li></ul></body></html>");
  });
});

describe("textToMarkdown", () => {
  it("leaves consecutive plain lines as lines, not bullets", () => {
    const text = "We build tools for job seekers.\nOur team is remote.\nPython and Go are used daily.";

    expect(textToMarkdown(text, "")).toBe(text);
  });

  it("keeps a line that starts with # as escaped text", () => {
    expect(textToMarkdown("Build things.\n#LI-Remote", "")).toBe("Build things.\n\\#LI-Remote");
  });

  it("leaves lines separated by blank lines as paragraphs", () => {
    const text = "We build tools.\n\nWe ship weekly.";

    expect(textToMarkdown(text, "")).toBe(text);
  });
});

describe("canonicalizeSections", () => {
  it("joins two sections in a row that are renamed alike", () => {
    const md = "## Required qualifications\n\n- Java\n\n## Basic skills\n\n- SQL";

    expect(canonicalizeSections(md, "")).toBe("## Minimum Qualifications\n\n- Java\n- SQL");
  });

  it("keeps same-named sections apart when another section sits between them", () => {
    const md = "## About us\n\nA.\n\n## Benefits\n\nB.\n\n## Our mission\n\nC.";

    expect(canonicalizeSections(md, "")).toBe(
      "## About the Company\n\nA.\n\n## Benefits and Compensation\n\nB.\n\n## About the Company\n\nC.");
  });
});
