import type { SavedResponse } from "../models/responses";
import type { AppTrailService } from "../services/AppTrailService";

/**
 * Overwrites a dataset through the server and returns its new ETag. Going
 * through the API, not the disk, keeps the server's own idea of the current
 * ETag in step, so no stray change event follows the test's setup.
 */
export async function replaceDataset(api: AppTrailService, name: string, raw: string): Promise<string> {
  const response = await api.putDataset<SavedResponse>(name, raw, "*");
  if (response.status !== 200) throw new Error(`could not set up ${name}: the server answered ${response.status}`);
  return response.data.etag;
}

/** The dataset's current ETag, read through the server. */
export async function currentEtag(api: AppTrailService, name: string): Promise<string> {
  const response = await api.getDataset<unknown>(name);
  if (response.status !== 200) throw new Error(`could not read ${name}: the server answered ${response.status}`);
  return response.headers["etag"];
}
