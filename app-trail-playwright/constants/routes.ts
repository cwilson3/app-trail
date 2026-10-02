/**
 * Every path spec.yml documents, in the spec's own spelling, with the
 * parameters a test can reach it at. SpecPaths, Routes and the sample URLs
 * the method tests use are all built from this one table, and
 * methods.api.test.ts fails if it and spec.yml list different paths.
 */
const ROUTE_TABLE = {
  HEALTH: { specPath: "/api/health", sample: {} },
  JDS: { specPath: "/api/jds", sample: {} },
  NOTE: { specPath: "/api/note", sample: {} },
  EVENTS: { specPath: "/api/events", sample: {} },
  CONFIG: { specPath: "/config.json", sample: {} },
  JOB_DESCRIPTION: { specPath: "/jds/{name}", sample: { name: "sample.md" } },
  DATASET: { specPath: "/data/{name}", sample: { name: "data.json" } },
} as const;

type RouteKey = keyof typeof ROUTE_TABLE;

export const SpecPaths = Object.fromEntries(
  Object.entries(ROUTE_TABLE).map(([key, route]) => [key, route.specPath]),
) as { [K in RouteKey]: (typeof ROUTE_TABLE)[K]["specPath"] };

export type SpecPath = (typeof SpecPaths)[RouteKey];

/** A spec path with its {parameters} filled in, each one URL-encoded. */
export function fillPath(specPath: SpecPath, params: Record<string, string>): string {
  return specPath.replace(/\{([^}]+)\}/g, (_, key: string) => {
    if (!(key in params)) throw new Error(`no value for {${key}} in ${specPath}`);
    return encodeURIComponent(params[key]);
  });
}

/** A URL each documented path can be requested at. */
export function sampleUrl(specPath: string): string {
  const route = Object.values(ROUTE_TABLE).find(r => r.specPath === specPath);
  if (!route) throw new Error(`${specPath} is not in constants/routes.ts`);
  return fillPath(route.specPath, route.sample);
}

/**
 * The documented path a request URL belongs to, or null - "/" and the other
 * static files are not in the spec. A {parameter} at the end of a path takes
 * the rest of it, as routes.js matches it.
 */
export function specPathFor(url: string): SpecPath | null {
  const pathname = new URL(url, "http://localhost").pathname;
  for (const specPath of Object.values(SpecPaths)) {
    const brace = specPath.indexOf("{");
    if (brace === -1 ? pathname === specPath : pathname.startsWith(specPath.slice(0, brace))) return specPath;
  }
  return null;
}

export const Routes = {
  HEALTH: SpecPaths.HEALTH,
  JDS: SpecPaths.JDS,
  NOTE: SpecPaths.NOTE,
  EVENTS: SpecPaths.EVENTS,
  CONFIG: SpecPaths.CONFIG,
  jobDescription: (name: string) => fillPath(SpecPaths.JOB_DESCRIPTION, { name }),
  dataset: (name: string) => fillPath(SpecPaths.DATASET, { name }),
} as const;
