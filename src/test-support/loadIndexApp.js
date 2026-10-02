/**
 * Loads index.html into a window of its own for a Vitest test, with fetch
 * answered by a stand-in for server.js.
 *
 * The app is one HTML file with no build step, so there is no module to import:
 * the page is parsed into a fresh jsdom window and its scripts are run there in
 * document order, as a browser would, with a line added to the app's own script
 * that hands chosen internals back out on window.__app.
 *
 * Every load gets a new window, and the window is closed when the test ends -
 * which drops its listeners and clears its timers - so nothing one test's page
 * set up can answer another test's events or send another test's requests. It
 * closes once every request the page sent has been answered and handled, the
 * way a page finishes what it started before it goes.
 * While a page is loaded, the globals a test reads (window, document,
 * localStorage, and the event and element classes it constructs) are that
 * page's own.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { afterEach, vi } from "vitest";
import { bindRoutes } from "../routes.js";
import { etagOf } from "../store.js";

/* The folder index.html and the scripts it loads sit in. */
const PAGE_DIR = resolve(import.meta.dirname, "..");
const HTML = readFileSync(resolve(PAGE_DIR, "index.html"), "utf8");

/* Where the page is served from, as server.js serves it. */
const PAGE_URL = "http://localhost:8787/";

/* The key the browser copy lives under - a promise to every browser that has one. */
export const LS_KEY = "app-track.v1";

const DEFAULT_EXPORTS = `
window.__app = {
  get state(){ return state; },
  get mode(){ return mode; },
  touch
};
`;

/* The page's scripts in document order: one it loads by src is read from
   beside index.html, an inline one is taken as written. */
const SCRIPTS = [...HTML.matchAll(/<script(?: src="([^"]+)")?>([\s\S]*?)<\/script>/g)]
  .map(([, src, code]) => src ? readFileSync(resolve(PAGE_DIR, src), "utf8") : code);

/* The app's own script, handing `exports` out and keeping the promise boot()
   returns, so a load can wait for the page to finish starting. */
function withExports(code, exports){
  if (!code.includes("async function boot()")) return code;
  if (!code.includes("\nboot();")) throw new Error("index.html: app script no longer ends with boot()");
  return code.replace("\nboot();", exports + "\nwindow.__booted = boot();");
}

/* The globals a test reads, taken from the loaded page's window. */
const PAGE_GLOBALS = ["document", "localStorage", "Event", "KeyboardEvent", "MouseEvent", "FocusEvent", "HTMLAnchorElement"];

let page = null;
const inFlight = new Set();

/* A request the page sent, kept until it has been answered. */
function track(promise){
  inFlight.add(promise);
  promise.then(() => inFlight.delete(promise), () => inFlight.delete(promise));
  return promise;
}

async function closePage(){
  if (!page) return;
  /* what the page does with each answer may send another request */
  while (inFlight.size){
    await Promise.allSettled([...inFlight]);
    await new Promise(resolve => setImmediate(resolve));
  }
  page.window.close();
  page = null;
  vi.unstubAllGlobals();
}

afterEach(closePage);

/** The browser's storage as the page left it, as { key: value }. */
function storageOf(window){
  const out = {};
  for (let i = 0; i < window.localStorage.length; i++){
    const key = window.localStorage.key(i);
    out[key] = window.localStorage.getItem(key);
  }
  return out;
}

const offline = () => Promise.reject(new TypeError("Failed to fetch"));

/**
 * Boots a fresh copy of the app and waits until boot() has finished.
 *
 * @param {ReturnType<typeof fakeServer> | null} server  answers fetch; null for a page with no server
 * @param {{
 *   exports?: string,
 *   keepStorage?: boolean,
 *   stored?: Record<string, string>,
 *   before?: (window: any) => void
 * }} [opts]
 *   exports      script that sets window.__app, run inside the app's scope
 *   keepStorage  start with localStorage as the last page left it, the way a
 *                reload does; otherwise it starts empty
 *   stored       entries to put in localStorage before the page starts
 *   before       runs once the window exists, before any of the page's scripts
 */
export async function loadApp(server, { exports = DEFAULT_EXPORTS, keepStorage = false, stored = {}, before } = {}){
  const kept = keepStorage && page ? storageOf(page.window) : {};
  await closePage();

  page = new JSDOM(HTML, { url: PAGE_URL, runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = page;
  for (const [key, value] of Object.entries({ ...kept, ...stored })) window.localStorage.setItem(key, value);
  window.fetch = (url, init) => track((server ? server.fetch : offline)(url, init));
  vi.stubGlobal("window", window);
  for (const name of PAGE_GLOBALS) vi.stubGlobal(name, window[name]);
  if (before) before(window);

  for (const code of SCRIPTS) window.eval(withExports(code, exports));
  await window.__booted;
  return window.__app;
}

const header = (init, name) => {
  const hit = Object.entries(init.headers || {}).find(([k]) => k.toLowerCase() === name.toLowerCase());
  return hit ? hit[1] : undefined;
};

/**
 * A stand-in for server.js, answering the routes routes.js lists the way
 * spec.yml documents them. `files` is what is on disk in the data folder: a
 * GET carries the ETag server.js would give it, a write needs If-Match (428
 * without one), and a stale one gets 409 with the current document and its
 * ETag. Set `down` to make every request fail the way fetch does when the
 * server is unreachable.
 *
 * @param {Record<string, string>} files
 */
export function fakeServer(files){
  const requests = [];
  /* A response whose body is there at once - what the page reads of a real
     one - so everything the page does with an answer has run by the time the
     request has settled and the next turn of the event loop comes round. */
  const reply = (status, body, headers = {}) => ({
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(headers),
    text: async () => body == null ? "" : String(body),
    json: async () => JSON.parse(body)
  });
  const json = (status, obj, headers = {}) => reply(status, JSON.stringify(obj),
    Object.assign({ "Content-Type": "application/json; charset=utf-8" }, headers));
  const etag = name => etagOf(files[name]);
  const notFound = () => reply(404, "Not found");

  function writeDataset(method){
    return ({ name }, init) => {
      const ifMatch = header(init, "If-Match");
      if (!ifMatch) return reply(428, method + " /data/" + name + " needs an If-Match header carrying " +
        "the ETag you last read (or * to overwrite regardless).");
      if (ifMatch !== "*" && (!(name in files) || ifMatch !== etag(name))){
        const cur = name in files ? { etag: etag(name), data: JSON.parse(files[name]) } : { etag: null, data: null };
        return json(409, { conflict: true, ...cur }, cur.etag ? { ETag: cur.etag } : {});
      }
      files[name] = init.body;
      return json(200, { ok: true, etag: etag(name) }, { ETag: etag(name) });
    };
  }

  /* bindRoutes refuses a table that leaves out any route or method routes.js
     has, so the stand-in cannot fall behind the real server's API. */
  const dispatch = bindRoutes({
    "/api/health": { GET: () => json(200, { ok: true, file: "/data/data.json" }) },
    "/api/jds": { GET: () => json(200, { ok: true, dir: "jds", files: [] }) },
    "/api/note": { POST: (params, init) =>
      json(200, { ok: true, action: "updated", rows: JSON.parse(init.body).rows.length, title: "T", folder: "" }) },
    "/api/events": { GET: () => reply(200, "", { "Content-Type": "text/event-stream; charset=utf-8" }) },
    "/config.json": { GET: notFound },
    "/jds/{name}": { GET: notFound },
    "/data/{name}": {
      GET: ({ name }) => name in files ? reply(200, files[name], { ETag: etag(name) }) : notFound(),
      PUT: writeDataset("PUT"),
      POST: writeDataset("POST")
    }
  });

  const server = { requests, files, down: false, fetch: null };
  server.fetch = async (url, init = {}) => {
    const method = init.method || "GET";
    const path = String(url).split("?")[0];
    requests.push({ method, path, headers: init.headers || {}, body: init.body, keepalive: !!init.keepalive });
    if (server.down) throw new TypeError("Failed to fetch");

    const hit = dispatch(decodeURIComponent(new URL(path, PAGE_URL).pathname));
    if (!hit) return notFound();
    const handler = hit.handler(method);
    if (!handler) return reply(405, "Method not allowed", { Allow: hit.route.methods.join(", ") });
    return handler(hit.params, init);
  };
  return server;
}

export const puts = server => server.requests.filter(r => r.method === "PUT");

/** A tracker document with one row per company, ids r0, r1, ... */
export const doc = (...companies) => ({ version:1, savedAt:null,
  applications: companies.map((company, i) => ({ id:"r" + i, company, status:"Interview" })) });
