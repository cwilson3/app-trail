/**
 * Every route server.js answers, and the methods each one takes.
 *
 * This table is what the server dispatches on, and spec.yml documents the
 * same list - routes.test.js fails the moment the two disagree. server.js
 * binds a handler to every method here through bindRoutes(), which refuses to
 * start the server if one is missing or left over. So a new endpoint is a row
 * here, a handler in server.js and an entry in spec.yml, or nothing runs.
 *
 * Paths use spec.yml's own spelling. A {param} at the end of a path takes the
 * whole rest of it, slashes included, so a name the handler would refuse -
 * a/b.md, .bak - still reaches that handler and gets its 404, rather than
 * slipping through to the static files. A {param} anywhere else takes one
 * segment.
 *
 * Anything that matches no route can only be the page itself - GET / or
 * /index.html, and the jd-name.js it loads - and is 404 otherwise. That is not
 * the API, and spec.yml leaves it out.
 */

/** @typedef {{ path: string, methods: string[] }} Route */
/** @typedef {(req: import("http").IncomingMessage, res: import("http").ServerResponse, params: Record<string, string>) => unknown} Handler */

/** @type {Route[]} */
const ROUTES = [
  { path: "/api/health", methods: ["GET"] },
  { path: "/api/jds", methods: ["GET"] },
  { path: "/api/note", methods: ["POST"] },
  { path: "/api/events", methods: ["GET"] },
  { path: "/config.json", methods: ["GET"] },
  { path: "/jds/{name}", methods: ["GET"] },
  { path: "/data/{name}", methods: ["GET", "PUT", "POST"] }
];

const escapeRe = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* A route's path as a pattern, and the names of its parameters in order. */
const compiled = new WeakMap();
function compile(/** @type {Route} */ route) {
  let hit = compiled.get(route);
  if (!hit) {
    const keys = [];
    const source = route.path.split(/(\{[^}]+\})/).map((part, i, parts) => {
      if (!/^\{.+\}$/.test(part)) return escapeRe(part);
      keys.push(part.slice(1, -1));
      return i === parts.length - 2 && parts[i + 1] === "" ? "(.*)" : "([^/]+)";
    }).join("");
    hit = { re: new RegExp("^" + source + "$"), keys };
    compiled.set(route, hit);
  }
  return hit;
}

/**
 * The route a decoded pathname belongs to, with its parameters, or null.
 * @param {string} pathname
 * @param {Route[]} [routes]
 * @returns {{ route: Route, params: Record<string, string> } | null}
 */
function matchRoute(pathname, routes = ROUTES) {
  for (const route of routes) {
    const { re, keys } = compile(route);
    const m = re.exec(pathname);
    if (m) return { route, params: Object.fromEntries(keys.map((k, i) => [k, m[i + 1]])) };
  }
  return null;
}

/**
 * Ties a handler to every method of every route, and returns the dispatcher
 * server.js answers requests through. Throws, naming each one, if a route's
 * method has no handler, or a handler belongs to no route or method in the
 * table - so the table, the handlers and spec.yml cannot drift apart quietly.
 *
 * @param {Record<string, Record<string, Handler>>} handlers  by route path, then method
 * @param {Route[]} [routes]
 * @returns {(pathname: string) => { route: Route, params: Record<string, string>, handler: (method: string) => Handler | null } | null}
 */
function bindRoutes(handlers, routes = ROUTES) {
  const problems = [];
  for (const route of routes) {
    const bound = Object.keys(handlers[route.path] || {});
    for (const m of route.methods) if (!bound.includes(m)) problems.push(m + " " + route.path + " has no handler");
    for (const m of bound) if (!route.methods.includes(m)) problems.push(m + " " + route.path + " is handled but not in routes.js");
  }
  for (const p of Object.keys(handlers)) {
    if (!routes.some(r => r.path === p)) problems.push(p + " is handled but not in routes.js");
  }
  if (problems.length) throw new Error("routes.js and the handlers disagree:\n  " + problems.join("\n  "));

  return pathname => {
    const hit = matchRoute(pathname, routes);
    if (!hit) return null;
    const methods = handlers[hit.route.path];
    return Object.assign(hit, { handler: (/** @type {string} */ method) => Object.hasOwn(methods, method) ? methods[method] : null });
  };
}

module.exports = { ROUTES, matchRoute, bindRoutes };
