#!/usr/bin/env node
/**
 * Stage 3 of job-from-url: validate a candidate record and merge it into
 * the tracker's data.json, in the data folder paths.js resolves.
 *
 *   node apply.js --envelope env.json [--candidate cand.json] [--dry-run]
 *                 [--id <appId>] [--overwrite] [--data path] [--port 8787]
 *
 * Nothing reaches data.json without passing through validate() below, and
 * validate() is an allow-list: a key it does not know is a rejection, not a
 * passthrough. That is what keeps "also set status to Offer" - or "also add
 * these forty rows" - from being a thing a job posting can do.
 *
 * Two fields never come from the candidate at all. jobLink is the address the
 * user typed, and systemOfRecord is derived from that address, so neither can
 * be redirected by the page.
 *
 * This writes by default. With --dry-run it prints the same plan and stops
 * before touching data.json.
 */

const fs = require("fs");
const path = require("path");
const { bareHost, FIELDS, money, normalizeUrl, resolveFields } = require("./lib.js");

const { DATA_NAME, resolveDataPaths } = require("../../../../src/paths.js");
const { EMPTY, createStore } = require("../../../../src/store.js");

/* The tracker lives in the data folder paths.js resolves - outside the
   repository - beside its backup and the import log this appends to. server.js
   asks paths.js the same question, which is what lets serverAt() below
   recognise a server as serving this file. */
const DATA_URL = "/data/" + DATA_NAME;

/* With no server running, data.json is written the way server.js writes it:
   a backup, then a temporary file renamed into place. */
const store = createStore();

/* ------------------------------------------------------------- the tracker */

const pad2 = n => String(n).padStart(2, "0");
const todayISO = () => {
  const d = new Date();
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
};
const uid = () => Math.random().toString(36).slice(2, 10);

/* Follows blankApp() in index.html field for field, with one deliberate
   difference: rounds starts empty. The + button seeds a Screen round because
   someone clicking it is usually about to schedule one; an imported posting
   has no interview attached to it yet, and a placeholder round in "Scheduled /
   Pending" reads as a real one. */
function blankApp(nextNum){
  return {
    id: uid(), roleId: uid(), num: nextNum,
    company: "", postedOn: "", appliedOn: "", lastUpdate: todayISO(), status: "Ready",
    interest: "", awaiting: "", appliedVia: "", roleTitle: "", companyType: "", industry: "",
    roleType: "", workSetting: "", postedRange: { min: null, max: null }, localRange: { min: null, max: null },
    myRange: { min: null, max: null }, jobLink: "", companyWebsite: "", systemOfRecord: "",
    rounds: []
  };
}

/* A row this importer updates may predate roleId - it was written before the
   tracker minted one, and the page backfills only what it loads. Minting it
   here keeps data.json consistent whether or not the page has opened it since.
   A row from blankApp() already has one, so this is a no-op for a new row. */
function ensureRoleId(app){
  if (!app.roleId) app.roleId = uid();
  return app;
}

async function serverAt(port, dataPath){
  try {
    const res = await fetch("http://127.0.0.1:" + port + "/api/health", { signal: AbortSignal.timeout(800) });
    if (!res.ok) return null;
    const health = await res.json();
    /* Only talk to a server that is serving *this* data.json. */
    if (health && health.file && path.resolve(health.file) !== path.resolve(dataPath)) return null;
    return "http://127.0.0.1:" + port;
  } catch (e) { return null; }
}

/* With a server running, the document and its ETag both come from it, and
   the save sends that ETag back, so the server can refuse the write if the
   open page saved over it in between. A server that answers but cannot hand
   over data.json is an error, not a cue to read the file instead: that copy
   would have no ETag, and the save would go through unchecked. */
async function load(dataPath, origin){
  if (origin) {
    const res = await fetch(origin + DATA_URL, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) {
      throw new Error("the running tracker could not read data.json: HTTP " + res.status + ". Nothing was written.");
    }
    const etag = res.headers.get("etag");
    if (!etag) throw new Error("the running tracker sent data.json without an ETag. Nothing was written.");
    return { data: JSON.parse(await res.text()), etag };
  }
  const cur = await store.read(dataPath);
  return { data: cur ? JSON.parse(cur.raw) : structuredClone(EMPTY), etag: null };
}

async function save(data, dataPath, origin, etag){
  if (origin && !etag) {
    throw new Error("refusing to save through the running tracker without the ETag of the copy that was read");
  }
  data.savedAt = new Date().toISOString();
  const raw = JSON.stringify(data, null, 2);
  if (origin) {
    const res = await fetch(origin + DATA_URL, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "If-Match": etag
      },
      body: raw,
      signal: AbortSignal.timeout(5000)
    });
    if (res.status === 409) {
      throw new Error(
        "data.json changed while this import was being prepared - most likely the\n" +
        "  open tracker page saved over it. Nothing was written. Re-run the same\n" +
        "  command and it will build on the current file."
      );
    }
    if (!res.ok) throw new Error("server refused the save: HTTP " + res.status);
    return "server";
  }
  await store.write(dataPath, raw);
  return "file";
}

/* What makes two links the same posting. The scheme, a leading "www.", a
   trailing slash and the order of the query do not; tracking params are
   already gone through normalizeUrl. */
function linkKey(u){
  const url = normalizeUrl(u);
  url.searchParams.sort();
  return bareHost(url.hostname) + url.pathname.replace(/\/+$/, "") + url.search;
}

const sameLink = (a, b) => {
  if (!a || !b) return false;
  try { return linkKey(a) === linkKey(b); }
  catch (e) { return String(a).trim() === String(b).trim(); }
};

/* ------------------------------------------------------------------ output */

const isSet = v => (v && typeof v === "object" && "min" in v ? v.min != null : !!v);

const show = v => {
  if (v && typeof v === "object" && "min" in v) return money(v.min) + " - " + money(v.max);
  return String(v);
};

function report(lines){ for (const l of lines) console.log(l); }

/* ------------------------------------------------------------------- main */

function parseArgs(argv){
  const out = { envelope: null, candidate: null, commit: true, id: null,
                overwrite: false, data: null, port: 8787 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--envelope") out.envelope = argv[++i];
    else if (a === "--candidate") out.candidate = argv[++i];
    else if (a === "--id") out.id = argv[++i];
    else if (a === "--data") out.data = argv[++i];
    else if (a === "--port") out.port = Number(argv[++i]) || 8787;
    else if (a === "--commit") out.commit = true;   // default; kept for older callers
    else if (a === "--dry-run") out.commit = false;
    else if (a === "--overwrite") out.overwrite = true;
  }
  return out;
}

async function main(){
  const args = parseArgs(process.argv.slice(2));
  if (!args.envelope) {
    console.error("usage: apply.js --envelope <file> [--candidate <file>] [--dry-run] [--id <appId>] [--overwrite]");
    process.exit(2);
  }

  const envelope = JSON.parse(fs.readFileSync(path.resolve(args.envelope), "utf8"));

  let candidate = {};
  if (args.candidate) {
    const raw = JSON.parse(fs.readFileSync(path.resolve(args.candidate), "utf8"));
    candidate = raw && raw.fields && typeof raw.fields === "object" ? raw.fields : raw;
  }

  /* Both sources are validated independently, then the deterministic one wins
     every key it managed to fill (resolveFields in lib.js, which jd.js uses
     for the file's header too). */
  const { accepted, from, rejected } = resolveFields(envelope.fields || {}, candidate);

  /* The two fields the page never gets a vote on. */
  const trusted = envelope.trusted || {};
  if (trusted.jobLink) accepted.jobLink = trusted.jobLink;
  if (trusted.systemOfRecord) accepted.systemOfRecord = trusted.systemOfRecord;

  const paths = resolveDataPaths({ data: args.data });
  const dataPath = paths.data;
  const origin = await serverAt(args.port, dataPath);
  const { data, etag } = await load(dataPath, origin);
  data.applications = data.applications || [];

  const dup = data.applications.find(a => sameLink(a.jobLink, accepted.jobLink));
  let target = args.id ? data.applications.find(a => a.id === args.id) : null;
  if (args.id && !target) {
    console.error("No application with id " + args.id + " in " + dataPath);
    process.exit(1);
  }
  if (!target && dup) {
    console.log("");
    console.log("  Already tracked: #" + dup.num + "  " + (dup.company || "(no company)") +
                "  " + (dup.roleTitle || ""));
    console.log("  id " + dup.id);
    console.log("");
    console.log("  Nothing written. To fill this row's blanks from the posting:");
    console.log("    node apply.js --envelope " + args.envelope +
                (args.candidate ? " --candidate " + args.candidate : "") +
                " --id " + dup.id);
    console.log("");
    process.exit(0);
  }

  const isNew = !target;
  if (isNew) target = blankApp(data.applications.reduce((m, a) => Math.max(m, a.num || 0), 0) + 1);
  ensureRoleId(target);

  const changes = [];
  const skipped = [];
  for (const [key, value] of Object.entries(accepted)) {
    const before = target[key];
    if (isSet(before) && !args.overwrite) { skipped.push([key, before]); continue; }
    if (JSON.stringify(before) === JSON.stringify(value)) { skipped.push([key, before]); continue; }
    changes.push([key, before, value]);
  }

  const width = Math.max(...["field"].concat(
    changes.map(c => c[0]), skipped.map(s => s[0]), rejected.map(r => r[0])
  ).map(s => s.length));
  const padKey = k => k.padEnd(width, " ");

  const head = [
    "",
    "  " + (accepted.company || target.company || "(company unknown)") +
      "  -  " + (accepted.roleTitle || target.roleTitle || "(role unknown)"),
    "  source   " + envelope.url,
    "  read by  " + envelope.method,
    "  store    " + dataPath + (origin ? "  (via " + origin + ")" : "  (direct file write)"),
    ""
  ];
  report(head);

  for (const [key, before, value] of changes) {
    const note = key === "jobLink" ? "   the URL you gave me"
               : key === "systemOfRecord" ? "   from the hostname"
               : isSet(before) ? "   was " + show(before)
               : from[key] ? "   " + from[key] : "";
    console.log("  + " + padKey(key) + "  " + show(value) + note);
  }
  if (!changes.length) console.log("  (nothing new to write)");

  if (skipped.length) {
    console.log("");
    console.log("  already set, left alone" + (args.overwrite ? "" : "  (--overwrite to replace)"));
    for (const [key, before] of skipped) console.log("  = " + padKey(key) + "  " + show(before));
  }

  if (rejected.length) {
    console.log("");
    console.log("  dropped by validation");
    for (const [key, why] of rejected) console.log("  ! " + padKey(key) + "  " + why);
  }

  const explained = new Set(rejected.map(r => r[0]));
  const missing = FIELDS.map(f => f.key).filter(k => accepted[k] == null && !explained.has(k));
  if (missing.length) {
    console.log("");
    console.log("  not found  " + missing.join(", "));
  }

  console.log("");
  if (isNew) {
    console.log("  new application #" + target.num + "  (id " + target.id + ")");
    console.log("  status starts at \"Ready\"; appliedOn, both salary ranges you set," +
                " rounds and contacts are left empty for you - no interview" +
                " rounds are added by an import");
  } else {
    console.log("  updating #" + target.num + "  (id " + target.id + ")");
  }

  /* Saving an unchanged row would still bump lastUpdate and savedAt, replace
     data.json.bak with an identical copy - losing the real previous version -
     wake every open page and add a log line. */
  if (!isNew && !changes.length) {
    console.log("");
    console.log("  Nothing written - this row already holds everything the posting gave.");
    console.log("");
    return;
  }

  if (!args.commit) {
    console.log("");
    console.log("  Dry run - nothing written. Re-run without --dry-run to save.");
    console.log("");
    return;
  }

  for (const [key, , value] of changes) target[key] = value;
  target.lastUpdate = todayISO();
  if (isNew) data.applications.push(target);

  const via = await save(data, dataPath, origin, etag);

  try {
    fs.appendFileSync(paths.importLog,
      JSON.stringify({
        at: new Date().toISOString(),
        url: envelope.url, method: envelope.method,
        appId: target.id, num: target.num, action: isNew ? "create" : "update",
        wrote: changes.map(c => c[0]), rejected: rejected.map(r => r[0])
      }) + "\n");
  } catch (e) { /* the log is a courtesy, not a dependency */ }

  console.log("");
  console.log("  Saved " + changes.length + " field" + (changes.length === 1 ? "" : "s") +
              " to " + dataPath + (via === "server" ? " through the running server." : " directly."));
  if (via === "server") {
    console.log("  An open tracker page picks this up on its own - no reload needed.");
  } else {
    console.log("  The tracker was not running, so nothing was told about this. Reload the");
    console.log("  page if it is open, or it will save its older copy over this.");
  }
  console.log("");
}

if (require.main === module) {
  main().catch(e => { console.error("apply failed: " + (e.stack || e)); process.exit(1); });
}

module.exports = { blankApp, ensureRoleId, load, save, sameLink, serverAt };
