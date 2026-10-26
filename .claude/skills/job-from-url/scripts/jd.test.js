/**
 * Unit tests for how jd.js names the file it writes. The tracker page finds a
 * row's file by deriving the same name from the row, so the name has to come
 * from the row when one is given, and --name has to come out as a clean slug.
 * The header lists the fields it is given, in FIELDS order; which fields those
 * are - only what apply.js would accept - is resolveFields', in lib.test.js.
 * postingBody picks the body's source - markup over flat text - and cuts a
 * known board's whole page down to the posting; where the cut lands is
 * framePosting's, in lib.test.js.
 */

import { describe, expect, it } from "vitest";
import { fileSlug, headerLines, postingBody } from "./jd.js";

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

describe("postingBody", () => {
  const LINKEDIN_PAGE = { descriptionFrom: "page text", trusted: { systemOfRecord: "LinkedIn" } };
  const PAGE_HTML = "<div><a href=\"/signin\">Sign in</a></div><button>Report this job</button>" +
    "<div class=\"description\"><h2>Responsibilities</h2><ul><li><p>Write tests</p></li><li>Review code</li></ul>" +
    "<p>We ship weekly.</p></div><button>Show more</button><h3>Seniority level</h3>";

  it("keeps a LinkedIn page's lists and headings from its markup, without the page around them", () => {
    const { body } = postingBody(LINKEDIN_PAGE, { html: PAGE_HTML, text: "" }, "");

    expect(body).toBe("## Responsibilities\n\n- Write tests\n- Review code\n\nWe ship weekly.");
  });

  it("says the page around the posting was removed", () => {
    const { framed } = postingBody(LINKEDIN_PAGE, { html: PAGE_HTML, text: "" }, "");

    expect(framed).toBe(true);
  });

  it("keeps the whole page, not framed, when the board's markers are missing", () => {
    const html = "<p>Sign in</p><ul><li>Write tests</li></ul>";

    expect(postingBody(LINKEDIN_PAGE, { html, text: "" }, "")).toEqual(
      { body: "Sign in\n\n- Write tests", from: "markup", framed: false });
  });

  it("does not frame a board's own description, even one from LinkedIn", () => {
    const env = { descriptionFrom: "JSON-LD", trusted: { systemOfRecord: "LinkedIn" } };

    expect(postingBody(env, { html: "<p>Report this job</p><p>Build.</p><p>Show more</p>", text: "" }, "").framed).toBe(false);
  });

  it("reads the flat text when there is no markup", () => {
    const env = { descriptionFrom: "pasted text", trusted: { systemOfRecord: "LinkedIn" } };

    expect(postingBody(env, { html: "", text: "- Write tests\n- Review code" }, "").body).toBe("- Write tests\n- Review code");
  });
});
