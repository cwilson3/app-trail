import fs from "fs";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { parse } from "yaml";
import type { ApiResponse } from "../models/responses";
import { SPEC_FILE } from "./appRepo";

const SPEC_ID = "app-trail-spec";

/** Every method an OpenAPI path item can hold, upper case. */
export const VERBS = ["GET", "PUT", "POST", "DELETE", "PATCH", "HEAD", "OPTIONS", "TRACE"] as const;

type Ref = { $ref: string };
type SpecHeader = { schema: object; required?: boolean };
type SpecResponse = { content?: Record<string, { schema: object }>; headers?: Record<string, SpecHeader | Ref> };
type SpecOperation = { responses: Record<string, SpecResponse | Ref> };
type ArraySchema = { minItems?: number; maxItems?: number };
type Spec = { paths: Record<string, Record<string, unknown>> };

const spec = parse(fs.readFileSync(SPEC_FILE, "utf8")) as Spec;
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema({ ...spec, $id: SPEC_ID });
const validators = new Map<string, ValidateFunction>();

const escape = (segment: string) => segment.replace(/~/g, "~0").replace(/\//g, "~1");
const isRef = (node: object): node is Ref => "$ref" in node;

function at<T>(pointer: string): T {
  return pointer.split("/").slice(1)
    .map(s => s.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], spec) as T;
}

/** Follows a $ref if there is one; returns the node and the JSON pointer it lives at. */
function resolve<T extends object>(node: T | Ref, pointer: string): { node: T; pointer: string } {
  if (!isRef(node)) return { node, pointer };
  const target = node.$ref.slice(1);
  return { node: at<T>(target), pointer: target };
}

function validatorFor(pointer: string): ValidateFunction {
  let validate = validators.get(pointer);
  if (!validate) {
    validate = ajv.compile({ $ref: `${SPEC_ID}#${pointer}` });
    validators.set(pointer, validate);
  }
  return validate;
}

/** Every documented path with the HTTP methods it takes, upper case. */
export function specOperations(): { path: string; methods: string[] }[] {
  return Object.entries(spec.paths).map(([p, item]) => ({
    path: p,
    methods: Object.keys(item).map(k => k.toUpperCase()).filter(k => (VERBS as readonly string[]).includes(k)),
  }));
}

/** The table limits spec.yml gives POST /api/note's request body. */
export function noteRequestLimits(): { minColumns: number; maxColumns: number; maxRows: number } {
  const body = "/paths/~1api~1note/post/requestBody/content/application~1json/schema/properties";
  const columns = at<ArraySchema>(`${body}/columns`), rows = at<ArraySchema>(`${body}/rows`);
  if (columns.minItems == null || columns.maxItems == null || rows.maxItems == null) {
    throw new Error("spec.yml no longer gives POST /api/note's columns minItems and maxItems, and rows maxItems");
  }
  return { minColumns: columns.minItems, maxColumns: columns.maxItems, maxRows: rows.maxItems };
}

/**
 * What is wrong with `response` as one `documented` response: its content
 * type, its body against that content type's schema, a required header that
 * is missing, or a documented header that does not validate.
 */
function responseProblems(response: ApiResponse<unknown>, documented: { node: SpecResponse; pointer: string }, label: string): string[] {
  const problems: string[] = [];
  const mediaType = (response.headers["content-type"] ?? "").split(";")[0].trim();
  const content = documented.node.content ?? {};
  if (!(mediaType in content)) {
    problems.push(`${label}: content type "${mediaType}" is not one of ${JSON.stringify(Object.keys(content))}`);
  } else {
    const validateBody = validatorFor(`${documented.pointer}/content/${escape(mediaType)}/schema`);
    if (!validateBody(response.data)) problems.push(`${label}: body ${ajv.errorsText(validateBody.errors)}`);
  }
  for (const [name, header] of Object.entries(documented.node.headers ?? {})) {
    const resolved = resolve(header, `${documented.pointer}/headers/${escape(name)}`);
    const value = response.headers[name.toLowerCase()];
    if (value === undefined) {
      if (resolved.node.required) problems.push(`${label}: the ${name} header is missing`);
      continue;
    }
    const validateHeader = validatorFor(`${resolved.pointer}/schema`);
    if (!validateHeader(value)) problems.push(`${label}: ${name} header ${ajv.errorsText(validateHeader.errors)}`);
  }
  return problems;
}

/**
 * Everything that keeps the response from being one spec.yml documents for
 * the operation it answered: a listed status code, a listed content type, a
 * body that validates against that content type's schema, every required
 * header present, and every documented header that is present valid. Empty
 * when there is nothing wrong.
 */
export function specProblems(response: ApiResponse<unknown>): string[] {
  const { method, specPath } = response.operation;
  if (!specPath) return [`${method} ${response.url} is not a path spec.yml documents`];
  const label = `${method} ${specPath} ${response.status}`;
  const opPointer = `/paths/${escape(specPath)}/${method.toLowerCase()}`;
  const operation = at<SpecOperation | undefined>(opPointer);
  if (!operation) return [`${method} ${specPath} is not in spec.yml`];
  const status = String(response.status);
  if (!(status in operation.responses)) {
    return [`${method} ${specPath} does not document ${status}; it documents ${Object.keys(operation.responses).join(", ")}`];
  }
  return responseProblems(response, resolve(operation.responses[status], `${opPointer}/responses/${status}`), label);
}

/**
 * Everything that keeps the response from matching one of spec.yml's shared
 * responses, components/responses/<name> - for an answer, like a 405, that no
 * operation of its own documents. Empty when there is nothing wrong.
 */
export function componentProblems(response: ApiResponse<unknown>, name: string): string[] {
  const pointer = `/components/responses/${escape(name)}`;
  const node = at<SpecResponse | undefined>(pointer);
  if (!node) return [`spec.yml has no response component named ${name}`];
  return responseProblems(response, { node, pointer }, `${response.operation.method} ${response.url} as ${name}`);
}
