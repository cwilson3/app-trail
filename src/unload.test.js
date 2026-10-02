/**
 * Unit tests for the save the page sends as it unloads: one only when an edit
 * is still waiting, and sent so the browser does not drop it with the page.
 *
 * The app is loaded through test-support/loadIndexApp.js. fetch is a fake
 * server.js, so the requests the page made are read off `server.requests`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { doc, fakeServer, loadApp, puts } from "./test-support/loadIndexApp.js";

const MAIN = doc("Acme", "Globex");

let server, app;

async function boot(){
  server = fakeServer({ "data.json": JSON.stringify(MAIN) });
  app = await loadApp(server);
}

const unload = () => window.dispatchEvent(new Event("beforeunload", { cancelable:true }));

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("unloading the page", () => {
  it("sends no save once the last edit has been saved", async () => {
    await boot();
    vi.useFakeTimers();
    app.touch(app.state.applications[0]);
    await vi.advanceTimersByTimeAsync(500);                       // the debounced save goes out
    const before = puts(server).length;

    unload();

    expect(puts(server)).toHaveLength(before);
  });

  it("sends an edit that is still waiting with keepalive, so the browser keeps the request", async () => {
    await boot();
    app.touch(app.state.applications[0]);                         // debounce not yet run

    unload();

    expect(puts(server).map(r => r.keepalive)).toEqual([true]);
  });
});
