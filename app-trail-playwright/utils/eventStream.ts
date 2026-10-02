import http from "http";

export type ServerEvent = { event?: string; data?: string; retry?: number };

const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * A server-sent event stream read frame by frame. Playwright's request context
 * buffers a whole response, so it never returns from a stream that stays open.
 */
export class EventStream {
  private buffer = "";
  private readonly frames: ServerEvent[] = [];
  private readonly waiters: { resolve: (e: ServerEvent) => void; reject: (err: Error) => void }[] = [];
  private failure: Error | null = null;

  private constructor(
    private readonly request: http.ClientRequest,
    readonly status: number,
    readonly headers: http.IncomingHttpHeaders,
    body: http.IncomingMessage,
  ) {
    body.setEncoding("utf8");
    body.on("data", (chunk: string) => this.receive(chunk));
    body.on("error", err => this.fail(err));
    body.on("end", () => this.fail(new Error("the server closed the event stream")));
  }

  static open(url: string): Promise<EventStream> {
    return new Promise((resolve, reject) => {
      const request = http.get(url, response => {
        resolve(new EventStream(request, response.statusCode ?? 0, response.headers, response));
      });
      request.on("error", reject);
    });
  }

  /** The next frame that carries a field. `: ping` comments are not frames. */
  next(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<ServerEvent> {
    const ready = this.frames.shift();
    if (ready) return Promise.resolve(ready);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve: (e: ServerEvent) => { clearTimeout(timer); resolve(e); },
        reject: (err: Error) => { clearTimeout(timer); reject(err); },
      };
      const timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        reject(new Error(`no server-sent event within ${timeoutMs} ms`));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  /** The ETag of the next `change` event, skipping any other frame. */
  async nextChange(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
    for (;;) {
      const frame = await this.next(timeoutMs);
      if (frame.event === "change") return (JSON.parse(frame.data ?? "") as { etag: string }).etag;
    }
  }

  close(): void {
    this.request.destroy();
  }

  private receive(chunk: string): void {
    this.buffer += chunk;
    let end: number;
    while ((end = this.buffer.indexOf("\n\n")) !== -1) {
      const frame = parseFrame(this.buffer.slice(0, end));
      this.buffer = this.buffer.slice(end + 2);
      if (!frame) continue;
      const waiter = this.waiters.shift();
      if (waiter) waiter.resolve(frame);
      else this.frames.push(frame);
    }
  }

  private fail(err: Error): void {
    this.failure ??= err;
    for (const waiter of this.waiters.splice(0)) waiter.reject(err);
  }
}

function parseFrame(raw: string): ServerEvent | null {
  const frame: ServerEvent = {};
  for (const line of raw.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") frame.event = value;
    else if (field === "data") frame.data = frame.data === undefined ? value : frame.data + "\n" + value;
    else if (field === "retry") frame.retry = Number(value);
  }
  return Object.keys(frame).length ? frame : null;
}
