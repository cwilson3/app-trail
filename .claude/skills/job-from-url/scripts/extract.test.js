/**
 * Unit tests for how extract.js reads dates and board APIs: one value it
 * cannot use must cost only that field, and a board API that never answers
 * must give up within the --timeout the user passed.
 *
 * fetch is stubbed - it is the boundary to the board - so nothing here goes
 * out over the network.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fieldReport, fromApi, fromJsonLd, isoDay } from "./extract.js";

/* Past the largest time Date can hold (8.64e15 ms), so toISOString() throws. */
const OUT_OF_RANGE = 1e20;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isoDay", () => {
  it("returns null for a timestamp too large to be a date", () => {
    expect(isoDay(OUT_OF_RANGE)).toBeNull();
  });

  it("turns a millisecond timestamp into its UTC day", () => {
    expect(isoDay(Date.UTC(2026, 8, 30, 12))).toBe("2026-09-30");
  });
});

describe("fromJsonLd", () => {
  it("keeps the other fields when datePosted is out of range", () => {
    const job = { "@type": "JobPosting", title: "Engineer", datePosted: OUT_OF_RANGE,
                  hiringOrganization: { name: "Acme" } };

    expect(fromJsonLd(job).fields).toEqual({ company: "Acme", roleTitle: "Engineer" });
  });
});

describe("fromApi", () => {
  it("gives up on a board API after the timeout it was given", async () => {
    /* A board that never answers: the request ends only when its signal aborts. */
    vi.stubGlobal("fetch", (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason));
    }));

    const result = await fromApi(new URL("https://boards.greenhouse.io/acme/jobs/123"), { timeout: 20 });

    expect(result).toMatchObject({ api: "greenhouse", error: expect.stringMatching(/timeout|aborted/i) });
  }, 1000);
});

describe("fromApi with a board that answers", () => {
  /** A board API answering `body` for every address, keeping the addresses asked. */
  function boardAnswering(body){
    const asked = [];
    return { asked, getJson: async url => { asked.push(url); return body; } };
  }

  it("works out the text from the board's markup when it publishes no prose", async () => {
    const { getJson } = boardAnswering({ title: "Engineer", content: "<h2>About</h2><p>Ship it.</p>" });

    const result = await fromApi(new URL("https://boards.greenhouse.io/acme/jobs/123"), { getJson });

    expect(result.text).toBe("About\nShip it.");
  });

  it("uses Ashby's plain description when the posting has no markup", async () => {
    const id = "0f3c2a1b-9d8e-4f7a-b6c5-d4e3f2a1b0c9";
    const { getJson } = boardAnswering({ jobs: [{ id, title: "Engineer", descriptionPlain: "Ship it." }] });

    const result = await fromApi(new URL("https://jobs.ashbyhq.com/acme/" + id), { getJson });

    expect(result.text).toBe("Ship it.");
  });

  it("asks no board about an address on a host that is not its own", async () => {
    const { asked, getJson } = boardAnswering({});

    await fromApi(new URL("https://acme.com/acme/jobs/123"), { getJson });

    expect(asked).toEqual([]);
  });

  it("reports which board failed, and why", async () => {
    const getJson = async () => { throw new Error("HTTP 503"); };

    const result = await fromApi(new URL("https://boards.greenhouse.io/acme/jobs/123"), { getJson });

    expect(result).toEqual({ api: "greenhouse", error: "HTTP 503", fields: {}, html: "", text: "" });
  });
});

describe("fieldReport", () => {
  it("counts companyType as missing, so the reader is sent to look for it", () => {
    const fields = { company: "Acme", roleTitle: "Engineer", postedOn: "2026-09-30",
                     postedRange: { min: 150000, max: 180000 }, roleType: "Full-time",
                     industry: "Logistics", companyWebsite: "https://acme.com" };

    expect(fieldReport(fields).missing).toEqual(["companyType"]);
  });
});
