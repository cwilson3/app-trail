#!/usr/bin/env node
/**
 * Stage 1 of job-from-url: fetch one posting and read whatever can be read
 * without a model.
 *
 *   node extract.js <url> --out envelope.json [--timeout 15000]
 *
 * It tries, in order of how much we can trust the shape of the answer:
 *
 *   1. the applicant-tracking system's own API, when the URL names one
 *      (Greenhouse, Lever, Ashby, Workday, SmartRecruiters)
 *   2. the schema.org/JobPosting JSON-LD most boards embed in the page
 *   3. the page text, left for a model to read in a later, sandboxed stage
 *
 * Only (1) and (2) produce fields here, and even those are the *page's*
 * claims - typed, but not true. The one genuinely trustworthy output is the
 * `trusted` block, which is derived from the address the user typed.
 *
 * stdout is a summary with no field values in it, so the orchestrating agent
 * can decide what to do next without reading anything the page wrote. Values
 * go to the --out file, which only the sandboxed reader and the validator
 * ever open.
 */

const fs = require("fs");
const path = require("path");
const {
  systemOfRecord, normalizeUrl, htmlToText, decodeEntities, atsHost, ROLE_TYPES, FIELDS
} = require("./lib.js");

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
           "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_TEXT = 20000;
/* The description keeps its own, larger budget: the text file is a model's
   reading allowance, while the HTML below becomes a file the user keeps. */
const MAX_HTML = 400 * 1024;

/* ---------------------------------------------------------------- fetching */

/* Reads at most MAX_BYTES and hangs up. res.text() would buffer the whole
   response first, which leaves the cap doing nothing on the chunked replies
   that carry no content-length - the case it most needs to cover. */
async function readCapped(res){
  if (!res.body) return (await res.text()).slice(0, MAX_BYTES);
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let out = "", size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    out += decoder.decode(value, { stream: true });
    if (size >= MAX_BYTES) { await reader.cancel(); break; }
  }
  return out;
}

async function get(url, opts){
  const o = opts || {};
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(o.timeout || 15000),
    headers: Object.assign({
      "User-Agent": UA,
      "Accept-Language": "en-US,en;q=0.9"
    }, o.headers || {})
  });
  if (!res.ok) {
    if (res.body) await res.body.cancel().catch(() => {});
    throw new Error("HTTP " + res.status);
  }
  return { body: await readCapped(res), finalUrl: res.url || url };
}

/* `opts` carries --timeout through from the command line, as get() does. */
async function getJson(url, opts){
  const { body } = await get(url, Object.assign({}, opts, { headers: { Accept: "application/json" } }));
  return JSON.parse(body);
}

/* ------------------------------------------------------- shared conversions */

/* Only annual USD survives. An hourly rate or a figure in another currency
   written into a field the app renders with a "$" would be a lie, and there
   is no safe exchange rate to guess. */
function annualUsd(min, max, unit, currency){
  const u = String(unit || "YEAR").toUpperCase().replace(/[^A-Z]/g, "");
  if (u && !/^(YEAR|ANNUAL|YEARLY|ANNUALLY|PERYEARSALARY|1YEAR)$/.test(u)) return null;
  const c = String(currency || "USD").toUpperCase();
  if (c && c !== "USD") return null;
  const lo = Number(min), hi = Number(max);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  return { min: Math.round(lo), max: Math.round(hi) };
}

const EMPLOYMENT = {
  FULLTIME: "Full-time", FULL: "Full-time", PARTTIME: "Part-time", PART: "Part-time",
  CONTRACTOR: "Contract", CONTRACT: "Contract", TEMPORARY: "Temporary", TEMP: "Temporary",
  INTERN: "Internship", INTERNSHIP: "Internship", VOLUNTEER: "Volunteer",
  PERDIEM: "Per diem", OTHER: null
};

function roleType(v){
  const list = Array.isArray(v) ? v : [v];
  for (const raw of list) {
    const hit = EMPLOYMENT[String(raw || "").toUpperCase().replace(/[^A-Z]/g, "")];
    if (hit && ROLE_TYPES.includes(hit)) return hit;
  }
  return null;
}

/* null for anything that is not a real day. A timestamp past what Date can
   hold makes toISOString() throw, which must not cost the import its other
   fields. */
function isoDay(v){
  if (v == null) return null;
  if (typeof v === "number") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + "-" + m[2] + "-" + m[3];
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);          /* Workday sometimes */
  if (m) return m[3] + "-" + m[1].padStart(2, "0") + "-" + m[2].padStart(2, "0");
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/* Drop null/empty so a later Object.assign layers sources cleanly. */
function compact(o){
  const out = {};
  for (const [k, v] of Object.entries(o || {})) {
    if (v == null || v === "" || (typeof v === "object" && !Object.keys(v).length)) continue;
    out[k] = v;
  }
  return out;
}

/* --------------------------------------------------------------- JSON-LD */

function findPosting(node, depth){
  if (!node || depth > 8) return null;
  if (Array.isArray(node)) {
    for (const n of node) { const hit = findPosting(n, depth + 1); if (hit) return hit; }
    return null;
  }
  if (typeof node !== "object") return null;
  const types = [].concat(node["@type"] || []);
  if (types.some(t => String(t).toLowerCase() === "jobposting")) return node;
  for (const key of ["@graph", "mainEntity", "mainEntityOfPage", "itemListElement", "item"]) {
    const hit = findPosting(node[key], depth + 1);
    if (hit) return hit;
  }
  return null;
}

function tryParse(raw){
  const s = raw.replace(/^\s*<!--/, "").replace(/-->\s*$/, "").trim();
  try { return JSON.parse(s); }
  catch (e) { try { return JSON.parse(decodeEntities(s)); } catch (e2) { return undefined; } }
}

function jsonLd(html){
  const open = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>/gi;
  let m;
  while ((m = open.exec(html)) !== null) {
    const start = m.index + m[0].length;
    /* An unescaped "</script>" inside the JSON - a description holding markup,
       usually - would cut the block short, so walk out to each following close
       tag until one of them parses. */
    for (let at = html.indexOf("</script>", start); at !== -1; at = html.indexOf("</script>", at + 9)) {
      const parsed = tryParse(html.slice(start, at));
      if (parsed === undefined) continue;
      open.lastIndex = at + 9;
      const job = findPosting(parsed, 0);
      if (job) return job;
      break;
    }
  }
  return null;
}

function fromJsonLd(job){
  if (!job) return { fields: {}, html: "", text: "" };
  const org = job.hiringOrganization || {};
  const sal = job.baseSalary || job.estimatedSalary || {};
  const val = sal && typeof sal.value === "object" ? sal.value : null;

  let range = null;
  if (val) range = annualUsd(val.minValue, val.maxValue, val.unitText, sal.currency || val.currency);

  const site = [].concat(org.sameAs || org.url || []).find(u => typeof u === "string" && /^https?:/i.test(u));

  return {
    fields: compact({
      company: typeof org.name === "string" ? org.name : null,
      roleTitle: typeof job.title === "string" ? job.title : null,
      postedOn: isoDay(job.datePosted),
      postedRange: range,
      roleType: roleType(job.employmentType),
      industry: typeof job.industry === "string" ? job.industry : null,
      companyWebsite: site || null
    }),
    html: typeof job.description === "string" ? job.description : "",
    text: job.description ? htmlToText(job.description) : ""
  };
}

/* ------------------------------------------------------------- board APIs */

/* The boards whose own API we read. Each names its vendor as lib.js's ATS
   table does - which is where its hostnames live - so fromApi() only asks a
   board about addresses on its own hosts. Adding a board is an entry here
   (and its hostnames in the ATS table, if they are new):

     match(url)             what the API needs from the address, or null if
                            this is not a posting URL on that board
     read(m, url, getJson)  the posting: { fields, html, text? }. text is only
                            for a board that publishes prose with no markup,
                            or prose that differs from it; otherwise it is
                            worked out from html. getJson is passed in, so a
                            board can be tried without the network.

   A throw is caught by fromApi() - a board API that is down or has changed
   shape must not stop the JSON-LD and text paths from working. */

/* Lever and Ashby share a URL shape: /{org}/{uuid}. */
const ORG_ID_PATH = /^\/([^/]+)\/([0-9a-f-]{20,})/i;

const BOARDS = [
  {
    name: "Greenhouse", api: "greenhouse",
    match: url => url.pathname.match(/^\/([^/]+)\/jobs\/(\d+)/),
    async read([, board, id], url, getJson){
      const base = "https://boards-api.greenhouse.io/v1/boards/" + encodeURIComponent(board);
      const [job, boardInfo] = await Promise.all([
        getJson(base + "/jobs/" + id + "?questions=false"),
        getJson(base).catch(() => null)                  /* company name; optional */
      ]);
      const pay = (job.pay_input_ranges || [])[0];
      return {
        fields: {
          company: (boardInfo && boardInfo.name) || null,
          roleTitle: job.title,
          postedOn: isoDay(job.first_published || job.updated_at),
          postedRange: pay ? annualUsd(pay.min_cents / 100, pay.max_cents / 100, "YEAR", pay.currency_type) : null
        },
        html: job.content
      };
    }
  },
  {
    name: "Lever", api: "lever",
    match: url => url.pathname.match(ORG_ID_PATH),
    async read([, org, id], url, getJson){
      const job = await getJson("https://api.lever.co/v0/postings/" + encodeURIComponent(org) + "/" + id);
      const sr = job.salaryRange || {};
      return {
        fields: {
          roleTitle: job.text,
          postedOn: isoDay(job.createdAt),
          roleType: roleType((job.categories || {}).commitment),
          postedRange: annualUsd(sr.min, sr.max, sr.interval, sr.currency)
        },
        /* Lever splits a posting into an intro and a series of named lists.
           Only the HTML side carries the list headings, so it is stitched back
           into one document in the order the board renders it; the board's
           own plain text is kept as the text. */
        html: [job.description]
          .concat((job.lists || []).map(l => "<h2>" + (l.text || "") + "</h2><ul>" + (l.content || "") + "</ul>"))
          .concat([job.additional])
          .filter(Boolean).join("\n"),
        text: [job.descriptionPlain, job.listsPlain].filter(Boolean).join("\n\n")
      };
    }
  },
  {
    name: "Ashby", api: "ashby",
    match: url => url.pathname.match(ORG_ID_PATH),
    async read([, org, id], url, getJson){
      const board = await getJson(
        "https://api.ashbyhq.com/posting-api/job-board/" + encodeURIComponent(org) + "?includeCompensation=true"
      );
      const job = (board.jobs || []).find(j => j.id === id);
      if (!job) return null;
      const comp = ((job.compensation || {}).summaryComponents || [])
        .find(c => String(c.compensationType || "").toLowerCase() === "salary");
      return {
        fields: {
          roleTitle: job.title,
          postedOn: isoDay(job.publishedAt),
          roleType: roleType(job.employmentType),
          postedRange: comp ? annualUsd(comp.minValue, comp.maxValue, comp.interval, comp.currencyCode) : null
        },
        html: job.descriptionHtml,
        text: job.descriptionHtml ? undefined : job.descriptionPlain    /* prose only when there is no markup */
      };
    }
  },
  {
    name: "Workday", api: "workday",
    match(url){
      let parts = url.pathname.split("/").filter(Boolean);
      if (/^[a-z]{2}(-[A-Za-z]{2})?$/.test(parts[0] || "")) parts = parts.slice(1);   /* locale prefix */
      if (parts[1] !== "job") return null;
      return { tenant: url.hostname.split(".")[0], site: parts[0], rest: parts.slice(1).join("/") };
    },
    async read({ tenant, site, rest }, url, getJson){
      const job = await getJson(
        "https://" + url.hostname + "/wday/cxs/" + encodeURIComponent(tenant) + "/" + encodeURIComponent(site) + "/" + rest
      );
      const info = job.jobPostingInfo || {};
      return {
        fields: {
          company: (job.hiringOrganization || {}).name || null,
          roleTitle: info.title,
          postedOn: isoDay(info.startDate),
          roleType: roleType(info.timeType)
        },
        html: info.jobDescription
      };
    }
  },
  {
    name: "SmartRecruiters", api: "smartrecruiters",
    match: url => url.pathname.match(/^\/([^/]+)\/(\d{6,})/),
    async read([, company, id], url, getJson){
      const job = await getJson(
        "https://api.smartrecruiters.com/v1/companies/" + encodeURIComponent(company) + "/postings/" + id
      );
      const sections = ((job.jobAd || {}).sections) || {};
      return {
        fields: {
          company: (job.company || {}).name || null,
          roleTitle: job.name,
          postedOn: isoDay(job.releasedDate),
          roleType: roleType((job.typeOfEmployment || {}).label),
          industry: (job.industry || {}).label || null
        },
        /* SmartRecruiters names its three blocks in the API rather than in the
           markup, so the names are put back as headings on the way through. */
        html: [
          ["About the Company", sections.companyDescription],
          ["About the Job", sections.jobDescription],
          ["Minimum Qualifications", sections.qualifications]
        ].filter(p => p[1] && p[1].text).map(p => "<h2>" + p[0] + "</h2>" + p[1].text).join("\n")
      };
    }
  }
];

/**
 * What the board's own API says about the posting at `url`, or null when no
 * board above serves it. A board that fails answers { api, error }.
 *
 * @param {URL} url
 * @param {{ timeout?: number, getJson?: (url: string) => Promise<any> }} [opts]
 *   getJson replaces the network; by default it fetches, within `timeout`.
 */
async function fromApi(url, opts = {}){
  const fetchJson = opts.getJson || (u => getJson(u, { timeout: opts.timeout }));
  for (const board of BOARDS) {
    if (!atsHost(url.hostname, board.name)) continue;
    const m = board.match(url);
    if (!m) continue;
    try {
      const hit = await board.read(m, url, fetchJson);
      if (!hit) continue;
      const html = hit.html || "";
      return { api: board.api, fields: compact(hit.fields), html, text: hit.text != null ? hit.text : htmlToText(html) };
    } catch (e) {
      return { api: board.api, error: String(e.message || e), fields: {}, html: "", text: "" };
    }
  }
  return null;
}

/* ------------------------------------------------------------------- main */

/* Which of the fields a posting may fill in this read found, by name only. */
function fieldReport(fields){
  const keys = FIELDS.map(f => f.key);
  return { found: keys.filter(k => fields[k] != null), missing: keys.filter(k => fields[k] == null) };
}

function parseArgs(argv){
  const out = { url: null, out: null, timeout: 15000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") out.out = argv[++i];
    else if (a === "--timeout") out.timeout = Number(argv[++i]) || 15000;
    else if (!out.url && !a.startsWith("-")) out.url = a;
  }
  return out;
}

async function main(){
  const args = parseArgs(process.argv.slice(2));
  if (!args.url || !args.out) {
    console.error("usage: extract.js <url> --out <file> [--timeout ms]");
    process.exit(2);
  }

  let url;
  try {
    url = normalizeUrl(args.url);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("not an http(s) address");
  } catch (e) {
    console.error("Not a usable URL: " + (e.message || e));
    process.exit(2);
  }

  const notes = [];

  /* Independent round trips - the board API is addressed from the URL alone
     and never looks at the page - so they overlap rather than queue. */
  const [page, api] = await Promise.all([
    get(url.href, { timeout: args.timeout }).catch(e => {
      notes.push("page fetch failed: " + (e.message || e));
      return { body: "", finalUrl: url.href };
    }),
    fromApi(url, { timeout: args.timeout })
  ]);

  /* A JSON-LD block that trips us up costs only its own fields: the board API
     and the page text still carry the import. */
  let ld;
  try { ld = fromJsonLd(page.body ? jsonLd(page.body) : null); }
  catch (e) {
    notes.push("JSON-LD could not be read: " + (e.message || e));
    ld = fromJsonLd(null);
  }
  if (page.body && !Object.keys(ld.fields).length) notes.push("no JobPosting JSON-LD in the page");
  if (api && api.error) notes.push(api.api + " API failed: " + api.error);

  /* API wins where it has an answer: it is typed at the source rather than
     re-serialised into a page. */
  const fields = Object.assign({}, ld.fields, compact((api && api.fields) || {}));

  /* The description, and where it came from. A board API or JSON-LD gives us
     the posting on its own; falling back to the whole page means the "posting"
     also contains the site's navigation, and jd.js says so in the file. */
  const desc = (api && !api.error && (api.html || api.text)) ? { from: api.api + " API", html: api.html || "", text: api.text || "" }
             : (ld.html || ld.text)                          ? { from: "JSON-LD", html: ld.html || "", text: ld.text || "" }
             : { from: "page text", html: "", text: htmlToText(page.body) || "" };
  const text = desc.text.slice(0, MAX_TEXT);
  const html = desc.html.slice(0, MAX_HTML);

  const method = [api && !api.error ? api.api + " API" : null,
                  Object.keys(ld.fields).length ? "JSON-LD" : null,
                  text ? "page text" : null].filter(Boolean).join(" + ") || "nothing";

  const outPath = path.resolve(args.out);
  const stem = outPath.replace(/(\.json)?$/, "");
  const textPath = stem + ".text.txt";
  const htmlPath = stem + ".desc.html";

  const envelope = {
    fetchedAt: new Date().toISOString(),
    url: url.href,
    finalUrl: page.finalUrl,
    host: url.hostname,
    method,
    notes,
    /* Derived from the address the user supplied. The page cannot reach these. */
    trusted: {
      jobLink: url.href,
      systemOfRecord: systemOfRecord(url)
    },
    /* The page's claims about itself. Typed, but not verified. */
    fields,
    /* The prose lives in its own file so that reading the envelope - which the
       validator and the orchestrator both do - cannot spill page content by
       accident. Only the sandboxed reader opens it. */
    textFile: text ? textPath : null,
    textChars: text.length,
    /* For jd.js. The description as the board published it, markup and all -
       headings and bullets survive here, and are gone from textFile. */
    descriptionFrom: (text || html) ? desc.from : null,
    htmlFile: html ? htmlPath : null,
    htmlChars: html.length
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(envelope, null, 2));
  if (text) fs.writeFileSync(textPath, text);
  else if (fs.existsSync(textPath)) fs.unlinkSync(textPath);
  if (html) fs.writeFileSync(htmlPath, html);
  else if (fs.existsSync(htmlPath)) fs.unlinkSync(htmlPath);

  /* Summary only - deliberately no field values, so reading this output does
     not put page-controlled text in front of the agent that can write. */
  const { found, missing } = fieldReport(fields);
  /* The sandboxed reader is where page prose is supposed to go, so send it
     there whenever anything is still blank rather than only when the record
     would be unusable without it. */
  const needsModel = !!text && missing.length > 0;

  console.log("envelope   " + outPath);
  console.log("host       " + url.hostname);
  console.log("system     " + envelope.trusted.systemOfRecord);
  console.log("method     " + method);
  console.log("found      " + (found.join(", ") || "(none)"));
  console.log("missing    " + (missing.join(", ") || "(none)"));
  console.log("text       " + text.length + " chars" + (text ? "  -> " + textPath : ""));
  console.log("posting    " + (desc.from || "(none)") +
              (html ? "  -> " + html.length + " chars of markup" : "  (no markup, flat text only)"));
  for (const n of notes) console.log("note       " + n);
  console.log("needsModel " + needsModel);
  if (!text && missing.length) console.log("blocked    nothing readable was retrieved");
}

if (require.main === module) {
  main().catch(e => { console.error("extract failed: " + (e.stack || e)); process.exit(1); });
}

module.exports = { isoDay, fromJsonLd, fromApi, fieldReport };
