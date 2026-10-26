/**
 * Shared helpers for the job-from-url skill. No dependencies, Node 18+.
 *
 * Everything in here is deterministic: given the same bytes it produces the
 * same answer, and nothing it returns depends on a model reading the page.
 */

/* Hostnames whose postings we can name with certainty. Used both to fill
   systemOfRecord (trusted - it comes from the URL, not the page) and to keep
   an ATS host from being written into the Company Website field. */
/** @type {Array<[RegExp, string]>} */
const ATS = [
  [/(^|\.)greenhouse\.io$/i,         "Greenhouse"],
  [/(^|\.)lever\.co$/i,              "Lever"],
  [/(^|\.)ashbyhq\.com$/i,           "Ashby"],
  [/(^|\.)myworkdayjobs\.com$/i,     "Workday"],
  [/(^|\.)myworkdaysite\.com$/i,     "Workday"],
  [/(^|\.)smartrecruiters\.com$/i,   "SmartRecruiters"],
  [/(^|\.)workable\.com$/i,          "Workable"],
  [/(^|\.)recruitee\.com$/i,         "Recruitee"],
  [/(^|\.)bamboohr\.com$/i,          "BambooHR"],
  [/(^|\.)jobvite\.com$/i,           "Jobvite"],
  [/(^|\.)icims\.com$/i,             "iCIMS"],
  [/(^|\.)taleo\.net$/i,             "Taleo"],
  [/(^|\.)successfactors\.com$/i,    "SuccessFactors"],
  [/(^|\.)breezy\.hr$/i,             "Breezy"],
  [/(^|\.)pinpointhq\.com$/i,        "Pinpoint"],
  [/(^|\.)paylocity\.com$/i,         "Paylocity"],
  [/(^|\.)rippling\.com$/i,          "Rippling"],
  [/(^|\.)dover\.com$/i,             "Dover"],
  [/(^|\.)linkedin\.com$/i,          "LinkedIn"],
  [/(^|\.)indeed\.com$/i,            "Indeed"],
  [/(^|\.)wellfound\.com$/i,         "Wellfound"],
  [/(^|\.)builtin\.com$/i,           "Built In"],
  [/(^|\.)otta\.com$/i,              "Otta"]
];

const bareHost = h => String(h || "").toLowerCase().replace(/^www\./, "");

/* The values a posting is allowed to supply for these two fields. The app
   itself treats them as free text, but a scrape is no place to invent
   vocabulary. Kept here because extract.js maps into them and apply.js
   validates against them - they must not drift apart.
   The list in ../../../agents/job-extract.md is a prose copy for the reader
   subagent; update it alongside these. */
const ROLE_TYPES = ["Full-time", "Part-time", "Contract", "Contract-to-hire",
                    "Internship", "Temporary", "Per diem", "Volunteer"];
const COMPANY_TYPES = ["Startup", "Scaleup", "Enterprise", "Public Company",
                       "Private Company", "Nonprofit", "Government", "Agency",
                       "Consultancy", "Academic"];

function isAtsHost(hostname){
  return ATS.some(([re]) => re.test(String(hostname || "")));
}

/* Is this host the named board? The adapters in extract.js ask through here
   rather than carrying their own copy of the pattern, so the table above stays
   the only place a vendor's hostnames are written down. */
function atsHost(hostname, name){
  return ATS.some(([re, n]) => n === name && re.test(String(hostname || "")));
}

/* Where the application will live. Derived from the address the user handed
   us, so a hostile page cannot influence it. */
function systemOfRecord(url){
  for (const [re, name] of ATS) if (re.test(url.hostname)) return name;
  if (url.searchParams.has("gh_jid")) return "Greenhouse";
  if (url.searchParams.has("lever-origin")) return "Lever";
  return "Company Portal";
}

/* Params that identify a click, not a posting. Stripped from the job link so
   a session token or campaign id doesn't get filed away forever. */
const TRACKERS = /^(utm_|_hs|mc_|pk_|ref_|vero_|oly_|hsa_)|^(fbclid|gclid|dclid|msclkid|igshid|mkt_tok|trk|trackingId|refId|referrer|source|src|from|campaign|sessionId|jobsearchTk|si)$/i;

function normalizeUrl(u){
  const url = new URL(u);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKERS.test(key)) url.searchParams.delete(key);
  }
  return url;
}

const NAMED = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "-",
  mdash: "-", lsquo: "'", rsquo: "'", ldquo: '"', rdquo: '"', hellip: "...",
  bull: "-", middot: "-", reg: "", copy: "", trade: ""
};

function decodeEntities(s){
  return String(s == null ? "" : s).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 9 || code > 0x10ffff) return " ";
      try { return String.fromCodePoint(code); } catch (e) { return " "; }
    }
    const hit = NAMED[body.toLowerCase()];
    return hit === undefined ? m : hit;
  });
}

/* Characters that let text lie about what it is: C0/C1 controls, soft hyphens,
   zero-width joiners, and the bidi overrides that can make a preview render
   one string while the file holds another. */
const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

function stripTags(html){
  return String(html == null ? "" : html)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|svg|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ");
}

/* A whole page's markup less what never holds words worth keeping - its
   <head>, scripts, styles and icons - which on a job board is most of the
   bytes. What is left is still markup, for htmlToMarkdown to read. */
function pageMarkup(html){
  return String(html == null ? "" : html)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi, " ")
    .replace(/<(script|style|svg|noscript|template|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/\s{2,}/g, m => (m.includes("\n") ? "\n" : " "));
}

/* HTML (or entity-escaped HTML, which some boards return) to flat text. The
   second decode catches entities that were hiding inside the first pass. */
function htmlToText(html){
  return decodeEntities(stripTags(decodeEntities(html)))
    .replace(INVISIBLE, "")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* Single-line, de-fanged text for a field value. Over-length is a rejection
   rather than a truncation: half of a hostile paragraph is still a hostile
   paragraph, and a 400-character company name is not a company name. */
function cleanText(v, max){
  if (v == null) return { ok: false, why: "missing" };
  const s = decodeEntities(stripTags(decodeEntities(String(v))))
    .replace(INVISIBLE, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return { ok: false, why: "empty once markup was removed" };
  if (s.length > max) return { ok: false, why: "longer than " + max + " characters (" + s.length + ")" };
  return { ok: true, value: s };
}

/* =========================================================================
   The job-description file

   `jds/<company>-<role>.md` - a local copy of the posting's own words, kept
   beside the tracker rather than inside it. Everything below is
   deterministic: the same page always produces the same file.
   ========================================================================= */

/* The file's name comes from ../../../../src/jd-name.js, which index.html loads
   too - one copy, so the page always finds the file this skill wrote. */
const { jdSlug, jdName } = require("../../../../src/jd-name.js");

/* Section headings vary by board - "You may be a good fit if you have",
   "What you'll bring" and "Minimum Qualifications" are one section wearing
   three hats. Recognised ones are renamed so a folder of postings can be read
   side by side; anything unrecognised keeps the posting's own wording, since a
   heading we cannot place is better left alone than guessed at.

   Order matters: "Preferred Qualifications" has to be tested before the rule
   that would claim every heading ending in "Qualifications". */
/** @type {Array<[RegExp, string]>} */
const SECTIONS = [
  [/^(preferred|desired|nice[ -]to[ -]have|bonus|additional|optional|even better|extra credit|good to have|it'?s a plus|pluses)\b|\b(nice to have|bonus points|a plus)\b/i,
   "Preferred Qualifications"],
  [/^(minimum|basic|required|requirements?|qualifications|must[ -]haves?|skills|experience|what (you'?ll|you) (bring|need|have)|what we'?re looking for|who you are|about you|you may be a good fit|we'?re looking for|the ideal candidate)\b/i,
   "Minimum Qualifications"],
  [/^(responsibilities|key responsibilities|your responsibilities|job responsibilities|what you'?ll (do|be doing|own)|in this role|day[ -]to[ -]day|duties|your impact|the impact you)\b/i,
   "Job Responsibilities"],
  [/^(about (the |our )?(company|us|team|organi[sz]ation)|who we are|our (mission|story|values|culture|team)|why (join|work)|the company)\b/i,
   "About the Company"],
  [/^(about (the |this )?(job|role|position|opportunity)|the (role|position|opportunity)|job (description|summary|overview|details)|role (description|overview|summary)|position (summary|overview)|overview|summary)\b/i,
   "About the Job"],
  [/^(benefits|perks|what we offer|compensation|pay( and benefits)?|salary|annual salary|total rewards|our offer)\b/i,
   "Benefits and Compensation"]
];

/* `company` is passed in so that "About Anthropic" files with "About us"
   instead of standing as a heading of its own. */
function canonicalSection(heading, company){
  const h = String(heading == null ? "" : heading).replace(/[:\s]+$/, "").trim();
  if (!h) return h;
  const co = String(company || "").trim();
  if (co && new RegExp("^about\\s+(the\\s+)?" + co.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(h)) {
    return "About the Company";
  }
  for (const [re, name] of SECTIONS) if (re.test(h)) return name;
  return h;
}

/* Block markers. Chosen from the C0 controls that INVISIBLE strips, so the
   conversions below can strip page content of them first and then use them as
   structure no posting can forge. */
const M_HEAD = "\u0002", M_ITEM = "\u0003", M_RULE = "\u0004";
const MARKS = M_HEAD + M_ITEM + M_RULE;

/* --------------------------------------------------------- html -> markdown */

/* Most boards hand the description back as real HTML - headings are <h2>,
   bullets are <li> - so converting from that keeps the structure the posting
   actually had, rather than inferring it back out of flattened text. */

const emphasise = (inner, mark) => {
  const core = inner.replace(/\s+/g, " ").trim();
  if (!core || /[*`_]/.test(core)) return inner;           /* already marked up */
  return (/^\s/.test(inner) ? " " : "") + mark + core + mark + (/\s$/.test(inner) ? " " : "");
};

/* What is left of the markup, minus any emphasis we just added - a heading
   reads better as "About us" than as "**About us**". */
const barePhrase = s => String(s).replace(/<[^>]*>/g, " ")
                                 .replace(/\s+/g, " ")
                                 .replace(/^[*`_\s]+|[*`_\s]+$/g, "")
                                 .trim();

function htmlToMarkdown(html){
  /* Invisibles go first, so the three markers are guaranteed absent from
     anything the page wrote before we start using them ourselves. */
  let s = String(html == null ? "" : html).replace(INVISIBLE, "");
  /* Greenhouse returns HTML with its angle brackets escaped, so the markup has
     to be decoded before the entities sitting inside it are - decode once and
     "&amp;nbsp;" is still an entity when <strong> is read, which puts the
     no-break space inside the emphasis instead of after it. */
  if (/&lt;[a-z!/]/i.test(s) && !/<[a-z!/]/i.test(s)) s = decodeEntities(s);
  s = decodeEntities(s);
  s = s.replace(/<!--[\s\S]*?-->/g, " ")
       .replace(/<(script|style|svg|noscript|template|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");

  /* Inline first, so a <strong> inside an <h2> is resolved before the heading
     rule reads that heading's text. */
  s = s.replace(/<\s*br\s*\/?>/gi, "\n");
  s = s.replace(/<a\b[^>]*\shref\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)[^>]*>([\s\S]*?)<\/a\s*>/gi, (m, href, label) => {
    const url = href.replace(/^['"]|['"]$/g, "").trim();
    const text = barePhrase(label);
    if (!text) return " ";
    /* javascript:, data:, mailto: and relative addresses keep their words and
       lose the link - a saved posting is no place for a live payload. */
    if (!/^https?:\/\//i.test(url)) return text;
    return "[" + text.replace(/[[\]]/g, "") + "](" + url.replace(/[()\s]/g, "") + ")";
  });
  s = s.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, (m, t, inner) => emphasise(inner, "**"));
  s = s.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, (m, t, inner) => emphasise(inner, "*"));
  s = s.replace(/<code\b[^>]*>([\s\S]*?)<\/code\s*>/gi, (m, inner) => emphasise(inner, "`"));

  /* Blocks. Every heading level collapses to "##": a posting's own h1/h2/h3
     nesting is decoration, and the file already has one h1 of its own. */
  s = s.replace(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]\s*>/gi, (m, inner) => "\n\n" + M_HEAD + barePhrase(inner) + "\n\n");
  /* A list item is taken whole: boards routinely wrap each <li>'s text in a
     <p>, and letting that <p> close first would push the item's own words onto
     the line after the marker, leaving a bullet with nothing in it. */
  s = s.replace(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi, (m, inner) =>
    "\n" + M_ITEM + inner.replace(/<\/?(p|div|br)\b[^>]*>/gi, " ").replace(/\s+/g, " ").trim() + "\n");
  s = s.replace(/<\/?li\b[^>]*>/gi, "\n");            /* any that were never closed */
  s = s.replace(/<hr\b[^>]*>/gi, "\n\n" + M_RULE + "\n\n");
  s = s.replace(/<\/(p|div|ul|ol|table|tr|section|article|header|footer|blockquote|dl|dd|dt)\s*>/gi, "\n\n");
  s = s.replace(/<[^>]*>/g, " ");
  /* Decoding again catches entities that were hiding inside the first pass. It
     runs per line, and past the marker, so a page that spells out a marker as
     an entity is stripped by INVISIBLE without taking our structure with it. */
  return renderBlocks(s.split("\n").map(line => {
    const mark = MARKS.includes(line[0]) ? line[0] : "";
    return mark + decodeEntities(mark ? line.slice(1) : line)
      .replace(INVISIBLE, "")
      .replace(/[^\S\n]+/g, " ")
      .trim();
  }));
}

/* --------------------------------------------------------- text -> markdown */

/* Lever's plain-text postings, and any page we could only scrape as text, have
   lost their markup. Headings are inferred back: a short standalone line that
   is not a sentence, and that either ends in a colon, reads as a title, or is
   a section name we already know. Deliberately conservative - a missed heading
   leaves a readable paragraph, while a false one buries a bullet under an h2. */
function looksLikeHeading(line, company){
  const s = line.trim();
  if (s.length < 2 || s.length > 80) return false;
  if (!/^[A-Za-z]/.test(s)) return false;
  if (/[.,;]$/.test(s) || /\.\s/.test(s)) return false;         /* a sentence, not a heading */
  const words = s.split(/\s+/);
  const colon = /:$/.test(s);
  if (words.length > (colon ? 12 : 9)) return false;
  if ((s.match(/\d/g) || []).length / s.length > 0.2) return false;
  if (colon) return true;
  if (canonicalSection(s, company) !== s) return true;          /* a section we recognise */
  const long = words.filter(w => w.length >= 4);
  return !!long.length && long.filter(w => /^[A-Z]/.test(w)).length * 2 >= long.length;
}

function textToMarkdown(text, company){
  const raw = String(text == null ? "" : text).replace(INVISIBLE, "").replace(/\r\n?/g, "\n");
  return renderBlocks(raw.split("\n").map(l => l.replace(/[^\S\n]+/g, " ").trim()).map(line => {
    const bullet = line.match(/^[-*•·‣▪◦–—]\s+(.*)$/);
    if (bullet) return M_ITEM + bullet[1].trim();
    if (looksLikeHeading(line, company)) return M_HEAD + line.replace(/[:\s]+$/, "");
    return line;
  }));
}

/* ------------------------------------------------------------ page framing */

/* Where a board's whole page is all we could read, the posting sits between
   lines the board always prints around it. Keyed by systemOfRecord, which
   comes from the URL the user typed, never from the page. Every marker is
   matched against a whole line, and the end only after the start, so a
   posting that says "save" mid-sentence moves neither.

     start     the line just above the posting
     end       any line that can follow it - the first one after start wins,
               so a posting too short to get its own "Show more" still stops
               at the job criteria rather than running on into similar jobs
     preamble  furniture some pages print between start and the posting:
               `open` is its first line, and it runs through each `close`
               for as long as the line after one is another `again`. Only
               a block that begins straight after start is skipped, so the
               posting's own words are never read as furniture. */
/** @type {Record<string, { start: RegExp, end: RegExp, preamble?: { open: RegExp, close: RegExp, again: RegExp } }>} */
const PAGE_FRAMES = {
  /* LinkedIn's guest view: sign-in forms and the title block above "Report
     this job"; below the description its "Show more" toggle, then the job
     criteria, similar jobs and footer. Some postings also get "Use AI to
     assess how you fit" after "Report this job" - a sign-in form per AI
     feature, each ending in the consent line, the next starting "Sign in to". */
  LinkedIn: {
    start: /^Report this job$/,
    end: /^(Show more|Show less|Seniority level|Employment type|Job function|Industries|Similar jobs|People also viewed|Referrals increase your chances .*)$/,
    preamble: {
      open: /^Use AI to assess how you fit$/,
      close: /^By clicking Continue to join or sign in, /,
      again: /^Sign in to /
    }
  }
};

/* A line as it reads, whether it came from flat text or from htmlToMarkdown:
   no list or heading mark, no emphasis, a link reduced to its words. */
const plainLine = l => String(l).trim()
  .replace(/^(?:#+|-)\s+/, "")
  .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
  .replace(/\*\*|\\(?=[#>])/g, "")
  .trim();

/* The posting out of a whole page - flat text or markdown, a line at a time -
   or null when the board has no frame or its markers are not where we expect:
   a changed layout keeps the whole page rather than losing the posting. */
function framePosting(page, system){
  const frame = PAGE_FRAMES[String(system || "")];
  if (!frame) return null;
  const lines = String(page == null ? "" : page).replace(/\r\n?/g, "\n").split("\n");
  const plain = lines.map(plainLine);
  const start = plain.findIndex(l => frame.start.test(l));
  if (start < 0) return null;
  const length = plain.slice(start + 1).findIndex(l => frame.end.test(l));
  if (length < 0) return null;
  const end = start + 1 + length;
  const from = frame.preamble ? afterPreamble(plain, start + 1, end, frame.preamble) : start + 1;
  const posting = lines.slice(from, end).join("\n").trim();
  return posting || null;
}

/* Where the posting begins, given that it would begin at `at` but for a
   preamble. Without one opening on the first line, `at` it is. */
function afterPreamble(plain, at, end, { open, close, again }){
  const next = i => { while (i < end && !plain[i]) i++; return i; };
  let i = next(at);
  if (i >= end || !open.test(plain[i])) return at;
  for (;;) {
    while (i < end && !close.test(plain[i])) i++;
    if (i >= end) return at;                        /* never closed: not the furniture we know */
    const after = next(i + 1);
    if (after >= end || !again.test(plain[after])) return i + 1;
    i = after;
  }
}

/* ------------------------------------------------------------- both paths */

/* Marker lines become markdown; everything else becomes body text. A body line
   that starts with "#" or ">" is escaped - the posting does not get to invent
   headings or block quotes in a file we are the author of. */
function renderBlocks(lines){
  const out = [];
  for (const line of lines) {
    if (line[0] === M_HEAD) {
      const h = line.slice(1).trim();
      if (h) out.push("", "## " + h, "");
    } else if (line[0] === M_ITEM) {
      const b = line.slice(1).trim().replace(/^[#>\s]+/, "");
      if (b) out.push("- " + b);
    } else if (line === M_RULE) {
      out.push("", "---", "");
    } else if (line) {
      out.push(line.replace(/^([#>])/, "\\$1"));
    } else {
      out.push("");
    }
  }
  return tidy(out.join("\n").replace(/[ \t]+$/gm, "")).trim();
}

/* No more than one blank line anywhere, and none between two bullets - <li>
   ends in a newline of its own, which would otherwise leave every bullet as
   its own paragraph-spaced block. */
const tidy = md => md.replace(/\n{3,}/g, "\n\n").replace(/^(- .*)\n\n(?=- )/gm, "$1\n");

/* Rewrites "## Heading" lines to their canonical names and leaves the rest of
   the document alone - except that two sections in a row which come out with
   the same name become one. A posting that splits "Required qualifications"
   from "Basic skills" would otherwise file two "Minimum Qualifications" back
   to back. Ones with another section between them are left apart: joining
   them would move text out of the order the posting put it in. */
function canonicalizeSections(markdown, company){
  let last = null;
  const out = [];
  for (const line of String(markdown == null ? "" : markdown).split("\n")) {
    const h = line.match(/^## +(.+)$/);
    if (!h) { out.push(line); continue; }
    const name = canonicalSection(h[1], company);
    if (name !== last) out.push("## " + name);
    last = name;
  }
  return tidy(out.join("\n"));
}

const money = n => "$" + Number(n).toLocaleString("en-US");

/* =========================================================================
   The fields a posting may fill in

   Each check returns { ok: true, value } with the value to store, or
   { ok: false, why }. They are allow-lists: anything they cannot vouch for is
   a rejection, never a passthrough.
   ========================================================================= */

const MIN_PAY = 10000;
const MAX_PAY = 2000000;

const bad = why => ({ ok: false, why });

function isoDate(v){
  const s = String(v == null ? "" : v).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return bad("not a YYYY-MM-DD date");
  const d = new Date(s + "T00:00:00Z");
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return bad("not a real date");
  const now = Date.now();
  if (d.getTime() > now + 30 * 864e5) return bad("more than 30 days in the future");
  if (d.getTime() < now - 1095 * 864e5) return bad("more than three years old");
  return { ok: true, value: s };
}

function payRange(v){
  if (!v || typeof v !== "object" || Array.isArray(v)) return bad("not a {min, max} object");
  const num = x => (typeof x === "number" ? x
                  : /^-?\d+(\.\d+)?$/.test(String(x).replace(/[$,\s]/g, "")) ? Number(String(x).replace(/[$,\s]/g, ""))
                  : null);
  const min = num(v.min), max = num(v.max);
  if (min === null || max === null) return bad("min and max must both be plain numbers");
  if (!Number.isFinite(min) || !Number.isFinite(max)) return bad("min and max must be finite");
  if (min < MIN_PAY || max < MIN_PAY) return bad("below " + money(MIN_PAY) + " - not an annual salary");
  if (min > MAX_PAY || max > MAX_PAY) return bad("above " + money(MAX_PAY));
  if (min > max) return bad("min is above max");
  return { ok: true, value: { min: Math.round(min), max: Math.round(max) } };
}

function webAddress(v){
  let u;
  try { u = new URL(String(v == null ? "" : v).trim()); }
  catch (e) { return bad("not a URL"); }
  if (u.protocol !== "https:" && u.protocol !== "http:") return bad("protocol " + u.protocol + " is not allowed");
  if (u.username || u.password) return bad("has credentials embedded in it");
  if (!u.hostname.includes(".")) return bad("no public hostname");
  if (isAtsHost(u.hostname)) return bad("points at a job board, not the company");
  /* Reduced to its origin: a hostname is all this field needs, and it leaves
     no path or query for a payload to ride in on. */
  return { ok: true, value: u.origin };
}

const oneOf = (list, label) => v => {
  const t = cleanText(v, 60);
  if (!t.ok) return t;
  const hit = list.find(x => x.toLowerCase() === t.value.toLowerCase());
  return hit ? { ok: true, value: hit } : bad("not one of the known " + label);
};

/* The one list of them. apply.js validates against it, extract.js reports
   which of them it found, and jd.js builds the file's header from it - so a
   new field is added here, and in the prose copy of this list the reader
   subagent works from (../../../agents/job-extract.md).
   Order is the order the JD header lists them in; `header: false` keeps a
   field out of it. */
const FIELDS = [
  { key: "company",        label: "Company",         validate: v => cleanText(v, 120),                 header: true },
  { key: "roleTitle",      label: "Role title",      validate: v => cleanText(v, 160),                 header: true },
  { key: "roleType",       label: "Role type",       validate: oneOf(ROLE_TYPES, "role types"),        header: true },
  { key: "companyType",    label: "Company type",    validate: oneOf(COMPANY_TYPES, "company types"),  header: false },
  { key: "industry",       label: "Industry",        validate: v => cleanText(v, 80),                  header: true },
  { key: "postedOn",       label: "Posted",          validate: isoDate,                                header: true },
  { key: "postedRange",    label: "Posted range",    validate: payRange,                               header: true },
  { key: "companyWebsite", label: "Company website", validate: webAddress,                             header: true }
];

/* Row fields a posting never fills in, and why. jobLink and systemOfRecord
   come from the address the user typed (the envelope's `trusted` block), and
   the rest are the user's own to set. */
const NEVER = {
  jobLink: "taken from the URL you supplied, not from the page",
  systemOfRecord: "derived from the hostname, not from the page",
  status: "yours to set",
  appliedOn: "yours to set",
  awaiting: "yours to set",
  appliedVia: "yours to set",
  myRange: "yours to set",
  localRange: "yours to set",
  rounds: "yours to set",
  id: "not auto-fillable",
  roleId: "not auto-fillable",
  num: "not auto-fillable",
  lastUpdate: "not auto-fillable"
};

const RULES = Object.fromEntries(FIELDS.map(f => [f.key, f.validate]));

/* Checks one source's fields against FIELDS. An allow-list: a key it does not
   know is a rejection, not a passthrough. */
function validate(source){
  /** @type {Record<string, any>} */
  const accepted = {};
  const rejected = [];
  for (const [key, raw] of Object.entries(source || {})) {
    if (raw == null || raw === "") continue;
    if (Object.hasOwn(NEVER, key)) { rejected.push([key, NEVER[key]]); continue; }
    const rule = Object.hasOwn(RULES, key) ? RULES[key] : null;
    if (!rule) { rejected.push([key, "not a field a posting may fill in"]); continue; }
    const res = rule(raw);
    if (res.ok) accepted[key] = res.value;
    else rejected.push([key, res.why]);
  }
  return { accepted, rejected };
}

/**
 * The fields a posting fills in, from its two sources: what extract.js read
 * from the markup (`marked`) and what the sandboxed reader read from the
 * prose (`read`). Each is validated on its own, then the markup wins every key
 * it managed to fill - the reader can add what the markup missed, but cannot
 * overrule what the markup already said. apply.js writes `accepted` into the
 * row, and jd.js builds the file's header from it, so the two always agree.
 *
 * @returns {{ accepted: Record<string, any>, from: Record<string, string | null>,
 *             rejected: Array<[string, string]> }}
 *   `from` says where each accepted value came from (null for the markup);
 *   `rejected` holds each key once, and only if neither source filled it.
 */
function resolveFields(marked, read){
  const m = validate(marked), r = validate(read);
  const accepted = Object.assign({}, r.accepted, m.accepted);
  /** @type {Record<string, string | null>} */
  const from = {};
  for (const k of Object.keys(r.accepted)) from[k] = "read from the posting";
  for (const k of Object.keys(m.accepted)) from[k] = null;
  const seen = new Set();
  const rejected = m.rejected.concat(r.rejected).filter(([k]) => {
    if (Object.hasOwn(accepted, k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { accepted, from, rejected };
}

module.exports = {
  ROLE_TYPES, COMPANY_TYPES, FIELDS, resolveFields,
  bareHost, isAtsHost, atsHost, systemOfRecord, normalizeUrl,
  decodeEntities, htmlToText, pageMarkup, cleanText, money,
  jdSlug, jdName, htmlToMarkdown, textToMarkdown, framePosting, canonicalizeSections, canonicalSection
};
