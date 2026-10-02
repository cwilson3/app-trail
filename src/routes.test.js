/**
 * Unit tests for routes.js - the table server.js dispatches through - and the
 * check that keeps it and spec.yml describing the same API.
 *
 * server.js answers only the paths and methods in routes.js, so if the table
 * matches spec.yml, a route cannot exist without being documented, and a
 * documented route cannot quietly go missing. What each route returns is the
 * Playwright API tests' job, against a running server; this only pins the
 * inventory, so it stays hermetic and runs in the unit test gate.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { ROUTES, bindRoutes, matchRoute } from "./routes.js";

const SPEC = parse(readFileSync(resolve(import.meta.dirname, "..", "spec.yml"), "utf8"));
const VERBS = ["get", "put", "post", "delete", "patch", "head", "options", "trace"];

/** @param {Record<string, Record<string, unknown>>} paths */
function specRoutes(paths){
  return Object.fromEntries(Object.entries(paths).map(([path, item]) =>
    [path, Object.keys(item).filter(k => VERBS.includes(k)).map(k => k.toUpperCase()).sort()]));
}

describe("routes.js against spec.yml", () => {
  it("declares exactly the paths and methods spec.yml documents", () => {
    const table = Object.fromEntries(ROUTES.map(r => [r.path, [...r.methods].sort()]));

    expect(table).toEqual(specRoutes(SPEC.paths));
  });
});

describe("matchRoute", () => {
  it("matches a fixed path with no parameters", () => {
    expect(matchRoute("/api/health")).toEqual({
      route: { path: "/api/health", methods: ["GET"] },
      params: {}
    });
  });

  it("captures a path parameter", () => {
    expect(matchRoute("/data/data.json").params).toEqual({ name: "data.json" });
  });

  it("captures the rest of the path, slashes included, so the handler can refuse it", () => {
    expect(matchRoute("/jds/a/b.md").params).toEqual({ name: "a/b.md" });
  });

  it("does not match a fixed path with anything after it", () => {
    expect(matchRoute("/api/health/extra")).toBeNull();
  });

  it("does not match a parameter route without its trailing slash", () => {
    expect(matchRoute("/data")).toBeNull();
  });

  it("leaves static files to the static handler", () => {
    expect(matchRoute("/index.html")).toBeNull();
  });

  it("captures a parameter in the middle of a path as one segment", () => {
    const routes = [{ path: "/boards/{board}/jobs/{id}", methods: ["GET"] }];

    expect(matchRoute("/boards/acme/jobs/7", routes).params).toEqual({ board: "acme", id: "7" });
  });

  it("does not let a parameter in the middle of a path take a slash", () => {
    const routes = [{ path: "/boards/{board}/jobs", methods: ["GET"] }];

    expect(matchRoute("/boards/a/b/jobs", routes)).toBeNull();
  });
});

describe("bindRoutes", () => {
  const ROUTE = { path: "/things/{id}", methods: ["GET", "PUT"] };
  const get = () => "got", put = () => "put";

  it("refuses a route whose method has no handler", () => {
    expect(() => bindRoutes({ "/things/{id}": { GET: get } }, [ROUTE])).toThrow("PUT /things/{id} has no handler");
  });

  it("refuses a handler for a method the route does not take", () => {
    expect(() => bindRoutes({ "/things/{id}": { GET: get, PUT: put, DELETE: get } }, [ROUTE]))
      .toThrow("DELETE /things/{id} is handled but not in routes.js");
  });

  it("refuses a handler for a path the table does not have", () => {
    expect(() => bindRoutes({ "/things/{id}": { GET: get, PUT: put }, "/other": { GET: get } }, [ROUTE]))
      .toThrow("/other is handled but not in routes.js");
  });

  it("dispatches a path to the handler for the request's method", () => {
    const dispatch = bindRoutes({ "/things/{id}": { GET: get, PUT: put } }, [ROUTE]);

    expect(dispatch("/things/9").handler("PUT")).toBe(put);
  });

  it("has no handler for a method the route does not take, so the server can answer 405", () => {
    const dispatch = bindRoutes({ "/things/{id}": { GET: get, PUT: put } }, [ROUTE]);

    expect(dispatch("/things/9").handler("DELETE")).toBeNull();
  });

  it("does not take a method name inherited from Object as a handler", () => {
    const dispatch = bindRoutes({ "/things/{id}": { GET: get, PUT: put } }, [ROUTE]);

    expect(dispatch("/things/9").handler("constructor")).toBeNull();
  });
});
