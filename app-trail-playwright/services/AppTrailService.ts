import type { APIRequestContext } from "@playwright/test";
import { Routes, specPathFor } from "../constants/routes";
import type { ApiResponse } from "../models/responses";
import type { NoteRequest, TrackerDocument } from "../models/tracker";

type Body = TrackerDocument | NoteRequest | string;

export class AppTrailService {
  constructor(private readonly request: APIRequestContext) {}

  getHealth<T>() {
    return this.send<T>("GET", Routes.HEALTH);
  }

  listJobDescriptions<T>() {
    return this.send<T>("GET", Routes.JDS);
  }

  getJobDescription<T>(name: string) {
    return this.send<T>("GET", Routes.jobDescription(name));
  }

  getConfig<T>() {
    return this.send<T>("GET", Routes.CONFIG);
  }

  getDataset<T>(name: string) {
    return this.send<T>("GET", Routes.dataset(name));
  }

  /** `ifMatch` omitted sends no If-Match header at all. */
  putDataset<T>(name: string, body: TrackerDocument | string, ifMatch?: string) {
    return this.send<T>("PUT", Routes.dataset(name), body, ifMatch === undefined ? {} : { "If-Match": ifMatch });
  }

  /** `ifMatch` omitted sends no If-Match header at all. */
  postDataset<T>(name: string, body: TrackerDocument | string, ifMatch?: string) {
    return this.send<T>("POST", Routes.dataset(name), body, ifMatch === undefined ? {} : { "If-Match": ifMatch });
  }

  writeNote<T>(body: NoteRequest | string) {
    return this.send<T>("POST", Routes.NOTE, body);
  }

  /**
   * Any request. The response carries the operation it answered - the method,
   * and the spec path the URL belongs to - so a spec check needs only the
   * response. A JSON body that does not parse comes back as its text, for the
   * spec check to report, rather than as a bare SyntaxError.
   */
  async send<T>(method: string, url: string, body?: Body, headers: Record<string, string> = {}): Promise<ApiResponse<T>> {
    const response = await this.request.fetch(url, {
      method,
      headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
      // A Buffer goes out byte for byte; a string that fails to parse would be JSON-encoded by Playwright.
      data: body === undefined ? undefined : Buffer.from(typeof body === "string" ? body : JSON.stringify(body)),
    });
    const text = await response.text();
    const isJson = (response.headers()["content-type"] ?? "").startsWith("application/json");
    return {
      status: response.status(),
      headers: response.headers(),
      data: (isJson ? parseOrText(text) : text) as T,
      url,
      operation: { method, specPath: specPathFor(url) },
    };
  }
}

function parseOrText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
