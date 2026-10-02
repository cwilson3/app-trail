#!/usr/bin/env node
/**
 * Tiny zero-dependency backend for the job application tracker.
 *
 *   node src/server.js        -> http://localhost:8787
 *   node src/server.js 9000   -> http://localhost:9000
 *   APP_TRAIL_DATA_DIR=/tmp/x node src/server.js   -> keep the data in /tmp/x
 *   APP_TRAIL_NOTE_COMMAND=/path/to/x node src/server.js
 *                          -> run x instead of osascript for the Note button
 *
 * Serves the app from this directory, and your data from the data folder
 * paths.js resolves - outside the repository, ~/Library/Application Support/
 * app-trail on macOS. The page still asks for data/data.json, jds/ and
 * config.json; those URLs are answered from that folder:
 *
 *   GET  /api/health       ->  {"ok":true, "file": <path of data.json>}
 *   GET  /api/jds          ->  the job descriptions saved under jds/
 *   GET  /jds/<name>.md    ->  one of them
 *   GET  /config.json      ->  settings - which note Note writes to
 *   POST /api/note         ->  writes the table you can see into a note in Notes.app
 *   GET  /api/events       ->  server-sent events; one "change" per write
 *   GET  /data/data.json   ->  the current data, with an ETag
 *   PUT  /data/data.json   ->  replaces the file (an atomic rename, plus one backup)
 *   GET/PUT /data/<name>.json  the same, for a separate dataset opened with
 *                          Import. Only data.json is watched and broadcast.
 *
 * Two things write to data.json: the open page, and the job-from-url
 * importer. Neither can see the other's changes, so the file is guarded by its
 * ETag - a hash of what is currently on disk:
 *
 *   - PUT must carry If-Match. A stale ETag is refused with 409 and the
 *     current document, so the writer can merge instead of overwriting.
 *     If-Match: * forces the write through.
 *   - Every change - through this server or straight to the file - is
 *     broadcast on /api/events, so an open page can pick it up immediately
 *     rather than sitting on a stale copy until its next save.
 *
 * spec.yml is the full contract for these routes (OpenAPI 3.1), and routes.js
 * is the table they are dispatched through; routes.test.js keeps the two in step.
 *
 * It only listens on 127.0.0.1, so nothing outside this machine can reach it.
 *
 * Loading this file starts nothing. createApp() builds the request handler
 * from what it is given - the data folder, the filesystem, the note writer -
 * and main() wires that to the real ones and listens, when the file is run.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream");
const { DATA_NAME, prepareDataDir, copiedNotice } = require("./paths.js");
const { bindRoutes } = require("./routes.js");
const { createStore } = require("./store.js");
const {
  NOTE_LIMITS, AUTOMATION_DENIED, readNoteConfig, parseNotePayload, noteHtml, noteRunner, isAutomationDenied
} = require("./note.js");

const DEFAULT_PORT = 8787;
const DATASET_LIMIT = 25 * 1024 * 1024;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".md": "text/markdown; charset=utf-8"
};
const typeOf = (/** @type {string} */ file) => TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";

/* Nothing the server sends is worth caching: every answer is the file as it is
   on disk right now. */
const NO_STORE = { "Cache-Control": "no-store" };

function send(res, code, body, type, headers) {
  res.writeHead(code, Object.assign({ "Content-Type": type || "text/plain; charset=utf-8" }, NO_STORE, headers || {}));
  res.end(body);
}

const sendJson = (res, code, obj, headers) => send(res, code, JSON.stringify(obj), TYPES[".json"], headers);

/* One server-sent `change` event. */
const changeFrame = (/** @type {string} */ etag) => "event: change\ndata: " + JSON.stringify({ etag }) + "\n\n";

/**
 * A bare file name in `dir`, or null: no folders, no dotfiles - and so never a
 * .bak or .tmp file - and only names `ext` matches. jds/ takes .md in any case,
 * since people drop files in by hand; datasets are named by the page, .json.
 *
 * @param {string} dir
 * @param {string | undefined} name
 * @param {RegExp} ext
 */
function safeChild(dir, name, ext) {
  if (!name || name.startsWith(".") || /[\/\\\0]/.test(name) || !ext.test(name)) return null;
  return path.join(dir, name);
}

const sizeText = n => n >= 1024 * 1024 ? n / (1024 * 1024) + " MiB" : n / 1024 + " KiB";

/* A body over `limit` bytes rejects with an error whose status is 413. The rest
   of it is no longer kept, but the socket stays up, so the caller can still say
   why - sent with Connection: close, nothing more is read after that answer. */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", c => {
      if (size > limit) return;
      size += c.length;
      if (size > limit) {
        chunks.length = 0;
        reject(Object.assign(new Error("The body is over " + sizeText(limit) + "."), { status: 413 }));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/* How a body that could not be read is answered, and whether to drop the
   connection afterwards - only once an oversized body has been abandoned. */
const bodyError = e => e.status === 413
  ? { code: 413, headers: { Connection: "close" } }
  : { code: 400, headers: {} };

/* Listening on 127.0.0.1 keeps other machines out, but not other web pages:
   any site open in a browser here can send a request to localhost. A foreign
   page shows itself in Origin, and DNS rebinding - a foreign name pointed at
   127.0.0.1 - shows itself in Host, so both must name this server. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

function isServer(origin, port) {
  try {
    const u = new URL(origin);
    return u.protocol === "http:" && LOCAL_HOSTS.has(u.hostname) && Number(u.port || 80) === port;
  } catch (e) {
    return false;
  }
}

function foreignRequest(req, port) {
  if (!isServer("http://" + (req.headers.host || ""), port)) return "Host";
  const origin = req.headers.origin;
  if (origin !== undefined && !isServer(origin, port)) return "Origin";
  return null;
}

/* A text/plain POST is a "simple" request a foreign page can send without a
   CORS preflight, so a body is only taken when it is labelled as JSON. */
const BODY_METHODS = new Set(["PUT", "POST"]);
const isJsonBody = req =>
  String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase() === "application/json";

/* The page and the one script it loads are the only static files. Everything
   else in the repository - .git/, node_modules, the old data/ folder - stays
   private. */
const STATIC_FILES = { "/": "index.html", "/index.html": "index.html", "/jd-name.js": "jd-name.js" };

/**
 * The request handler, and what the process around it drives: the watcher
 * calls changedOnDisk() when data.json is touched, and a timer calls ping().
 *
 * @param {{
 *   paths: { dir: string, data: string, jds: string, config: string },
 *   port?: number,
 *   root?: string,
 *   fsp?: typeof fs.promises,
 *   openFile?: (file: string) => import("stream").Readable,
 *   writeNote?: (title: string, folder: string, body: string) => Promise<string>,
 *   canWriteNotes?: boolean,
 *   log?: Pick<Console, "log" | "warn" | "error">
 * }} opts
 */
function createApp({
  paths, port = DEFAULT_PORT, root = __dirname, fsp = fs.promises, openFile = fs.createReadStream,
  writeNote = noteRunner("osascript"), canWriteNotes = process.platform === "darwin", log = console
}) {
  const store = createStore(fsp);
  /* data.json is made on first read; any other dataset that is not there is
     null, so a GET can 404 and a PUT knows it is creating the file. */
  const readData = (file = paths.data) => store.read(file, { createIfMissing: file === paths.data });

  /* Saves can overlap - the open page and the importer, or two open pages. A
     save is read-the-ETag-then-replace, which is only a guard if nothing slips
     in between: interleaved, two writers both match the same ETag and the
     second silently overwrites the first. So every save takes its turn here. */
  let writeQueue = Promise.resolve();
  /**
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  function withDataLock(fn) {
    const done = writeQueue.then(fn);
    writeQueue = done.then(() => {}, () => {});   // a failed save must not stall the queue
    return done;
  }

  /* -------------------------------------------------------------- events */

  const clients = new Set();
  /* The last ETag broadcast - only broadcast() sets it. changedOnDisk()
     compares against it to skip the echo of our own writes; a reader that set
     it would make a real change made on disk go unannounced. */
  let lastEtag = null;

  function broadcast(etag) {
    lastEtag = etag;
    for (const res of clients) {
      try { res.write(changeFrame(etag)); } catch (e) { clients.delete(res); }
    }
  }

  async function changedOnDisk() {
    try {
      const cur = await readData();
      if (cur.etag !== lastEtag) {
        broadcast(cur.etag);
        log.log("  " + DATA_NAME + " changed on disk  -> told " + clients.size + " page(s)");
      }
    } catch (e) { /* mid-write, or briefly unparseable; the next event covers it */ }
  }

  function ping() {
    for (const res of clients) {
      try { res.write(": ping\n\n"); } catch (e) { clients.delete(res); }
    }
  }

  /* ------------------------------------------------------------ handlers */

  /** @type {Record<string, Record<string, import("./routes.js").Handler>>} */
  const handlers = {
    "/api/health": {
      GET: (req, res) => sendJson(res, 200, { ok: true, file: paths.data })
    },

    /* The detail card works out a row's file name from its company and role,
       but it cannot tell a missing file from a name that drifted when the row
       was edited. This lists what is actually there so it can match on that. */
    "/api/jds": {
      GET: async (req, res) => {
        let files = [];
        try {
          files = (await fsp.readdir(paths.jds)).map(String).filter(f => /\.md$/i.test(f)).sort();
        } catch (e) { /* no jds/ yet - an empty list is the honest answer */ }
        return sendJson(res, 200, { ok: true, dir: "jds", files });
      }
    },

    /* jds/ and config.json used to sit in the repository and come back as
       plain static files. They live in the data folder now, so they are
       answered from there - a bare *.md name for a job description. */
    "/jds/{name}": {
      GET: (req, res, params) => sendFile(res, safeChild(paths.jds, params.name, /\.md$/i))
    },
    "/config.json": {
      GET: (req, res) => sendFile(res, paths.config)
    },

    "/api/note": {
      POST: async (req, res) => {
        if (!canWriteNotes) return sendJson(res, 501, { ok: false, error: "Notes.app is macOS only." });
        let payload, cfg;
        try {
          payload = parseNotePayload(await readBody(req, NOTE_LIMITS.maxBody));
          cfg = await readNoteConfig(paths.config, { fsp, warn: log.warn });
        } catch (e) {
          const { code, headers } = bodyError(e);
          return sendJson(res, code, { ok: false, error: e.message }, headers);
        }
        try {
          const action = await writeNote(cfg.title, cfg.folder, noteHtml(cfg.title, payload.columns, payload.rows));
          log.log(`  ${action} the note "${cfg.title}"  (${payload.rows.length} row(s))`);
          return sendJson(res, 200, { ok: true, action, rows: payload.rows.length, title: cfg.title, folder: cfg.folder });
        } catch (e) {
          const denied = isAutomationDenied(e.message);
          log.error("  note export failed:", e.message);
          return sendJson(res, denied ? 403 : 500, { ok: false, error: denied ? AUTOMATION_DENIED : e.message });
        }
      }
    },

    "/api/events": {
      GET: async (req, res) => {
        res.writeHead(200, Object.assign({ "Content-Type": "text/event-stream; charset=utf-8", Connection: "keep-alive" }, NO_STORE));
        res.write("retry: 2000\n\n");
        /* Registered before the read below: a page that goes away while it is
           awaited must still be dropped, not pinged forever. */
        clients.add(res);
        req.on("close", () => clients.delete(res));
        try {
          const cur = await readData();
          if (!res.writableEnded && clients.has(res)) res.write(changeFrame(cur.etag));
        } catch (e) { /* the page will still get the next change */ }
      }
    },

    "/data/{name}": {
      GET: async (req, res, { name }) => {
        const file = datasetFile(name);
        if (!file) return send(res, 404, "Not found");
        try {
          const cur = await readData(file);
          if (!cur) return send(res, 404, "Not found");
          return send(res, 200, cur.raw, TYPES[".json"], { ETag: cur.etag });
        } catch (e) {
          return send(res, 500, "/data/" + name + " could not be read: " + e.message);
        }
      },
      PUT: writeDataset,
      POST: writeDataset   // an alias of PUT; spec.yml marks it deprecated
    }
  };

  /* A dataset in the data folder. A case variant of data.json is refused: on a
     case-insensitive disk it is data.json, and a write to it would replace the
     tracker without telling the open page. */
  function datasetFile(name) {
    if (name !== DATA_NAME && String(name).toLowerCase() === DATA_NAME) return null;
    return safeChild(paths.dir, name, /\.json$/);
  }

  /** @type {import("./routes.js").Handler} */
  async function writeDataset(req, res, { name }) {
    const file = datasetFile(name);
    if (!file) return send(res, 404, "Not found");
    const ifMatch = req.headers["if-match"];
    if (!ifMatch) {
      return send(res, 428, req.method + " /data/" + name + " needs an If-Match header carrying " +
        "the ETag you last read (or * to overwrite regardless).");
    }
    let body;
    try {
      body = await readBody(req, DATASET_LIMIT);
    } catch (e) {
      const { code, headers } = bodyError(e);
      return send(res, code, "Could not save: " + e.message, null, headers);
    }
    try {
      /* checked and written as one turn, so the ETag we approve is still the
         one on disk when we replace it. If-Match: * reads nothing, so it can
         still replace a data.json that no longer parses. */
      const out = await withDataLock(async () => {
        if (ifMatch !== "*") {
          const cur = await readData(file);
          if (!cur || ifMatch !== cur.etag) return { stale: cur || { raw: "null", etag: null } };
        }
        return { etag: await store.write(file, body) };
      });

      if (out.stale) {
        const cur = out.stale;
        log.log("  refused a stale save of " + name + "  (had " + ifMatch + ", now " + cur.etag + ")");
        return sendJson(res, 409, { conflict: true, etag: cur.etag, data: JSON.parse(cur.raw) },
          cur.etag ? { ETag: cur.etag } : {});
      }

      if (file === paths.data) broadcast(out.etag);   // the page only follows data.json
      log.log(`  saved ${name}  (${(Buffer.byteLength(body) / 1024).toFixed(1)} kB)  ${new Date().toLocaleTimeString()}`);
      return sendJson(res, 200, { ok: true, etag: out.etag }, { ETag: out.etag });
    } catch (e) {
      log.error("  save failed:", e.message);
      return send(res, 400, "Could not save: " + e.message);
    }
  }

  async function sendFile(res, file) {
    if (!file) return send(res, 404, "Not found");
    try {
      return send(res, 200, await fsp.readFile(file), typeOf(file));
    } catch (e) {
      return send(res, 404, "Not found");
    }
  }

  /* Headers go out only once the file is open, so a missing or unreadable file
     is still a clean error response; a failure mid-stream just ends the
     response. Either way, an unhandled stream error would take the whole
     server down. */
  function sendStatic(res, rel) {
    const stream = openFile(path.join(root, rel));
    stream.once("error", (/** @type {NodeJS.ErrnoException} */ e) => {
      if (res.headersSent) return;
      if (e.code === "ENOENT") send(res, 404, "Not found");
      else send(res, 500, "Could not read " + rel);
    });
    stream.once("open", () => {
      res.writeHead(200, Object.assign({ "Content-Type": typeOf(rel) }, NO_STORE));
      pipeline(stream, res, () => {});
    });
  }

  /* routes.js says which paths are the API and which methods each takes, and
     spec.yml documents the same table. bindRoutes() refuses a table with a
     method left unhandled, so an endpoint missing from it - and so from the
     spec - cannot answer at all. */
  const dispatch = bindRoutes(handlers);

  /**
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   */
  async function handle(req, res) {
    const foreign = foreignRequest(req, port);
    if (foreign) return send(res, 403, "Forbidden: " + foreign + " is not this server");

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    } catch (e) {
      return send(res, 400, "Bad request");
    }

    const hit = dispatch(pathname);
    if (hit) {
      const handler = hit.handler(req.method);
      if (!handler) return send(res, 405, "Method not allowed", null, { Allow: hit.route.methods.join(", ") });
      if (BODY_METHODS.has(req.method) && !isJsonBody(req)) {
        return send(res, 415, "Content-Type must be application/json");
      }
      return handler(req, res, hit.params);
    }

    if (req.method !== "GET") return send(res, 405, "Method not allowed");
    const rel = Object.hasOwn(STATIC_FILES, pathname) ? STATIC_FILES[pathname] : null;
    if (!rel) return send(res, 404, "Not found");
    return sendStatic(res, rel);
  }

  return { handle, changedOnDisk, ping };
}

/* ------------------------------------------------------------------ main */

function main() {
  const port = Number(process.argv[2]) || DEFAULT_PORT;
  /* Everything the app stores - the document, its backup, the importer's log,
     config.json and jds/ - lives in one folder outside the repository, so none
     of it can be committed. paths.js decides where, and the job-from-url
     scripts ask it the same question. It is created here if missing, so a
     fresh clone needs no setup step, and the first run after upgrading copies
     over whatever the repository still holds. */
  const paths = prepareDataDir();
  /* The program that runs the Notes script. Anything else put here is called
     exactly as osascript would be, which lets the API tests record the note
     instead of writing one into Notes.app on the machine running them. */
  const noteCommand = process.env.APP_TRAIL_NOTE_COMMAND || "osascript";
  const app = createApp({
    paths, port,
    writeNote: noteRunner(noteCommand),
    canWriteNotes: noteCommand !== "osascript" || process.platform === "darwin"
  });

  setInterval(app.ping, 25000).unref();

  /* Watch the folder rather than the file: data.json is replaced by rename,
     which would leave a file watch pointing at the old inode. */
  let watchTimer = null;
  try {
    fs.watch(paths.dir, (ev, name) => {
      if (name !== DATA_NAME) return;
      clearTimeout(watchTimer);
      watchTimer = setTimeout(app.changedOnDisk, 120);
    });
  } catch (e) {
    console.warn("  (could not watch " + paths.dir + ": " + e.message + ")");
  }

  const server = http.createServer(app.handle);
  server.listen(port, "127.0.0.1", () => {
    console.log("");
    console.log("  AppTrail");
    console.log("  http://localhost:" + port);
    console.log("  data -> " + paths.data);
    const notice = copiedNotice(paths);
    if (notice) console.log("\n  " + notice);
    console.log("");
  });

  server.on("error", (/** @type {NodeJS.ErrnoException} */ e) => {
    if (e.code === "EADDRINUSE") {
      console.error("  Port " + port + " is already in use. Try: node src/server.js " + (port + 1));
      process.exit(1);
    }
    throw e;
  });
}

if (require.main === module) main();

module.exports = { createApp };
