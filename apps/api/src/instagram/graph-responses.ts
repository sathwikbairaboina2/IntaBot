import { z } from "zod";
import type { ContainerStatus } from "./instagram.port";

export interface GraphErrorDetails {
  /** HTTP status of the response; 0 when the call never got one. */
  status?: number;
  subcode?: number;
  type?: string;
  fbtraceId?: string;
}

/** A refused Graph call: Meta's error envelope, or a non-2xx answer without one. */
export class GraphError extends Error {
  readonly status: number;
  readonly subcode: number | undefined;
  readonly type: string | undefined;
  readonly fbtraceId: string | undefined;

  constructor(
    readonly code: number,
    message: string,
    details: GraphErrorDetails = {},
  ) {
    super(message);
    this.name = "GraphError";
    this.status = details.status ?? 0;
    this.subcode = details.subcode;
    this.type = details.type;
    this.fbtraceId = details.fbtraceId;
  }
}

/** The name the rest of the code base already uses. */
export const GraphApiError = GraphError;
export type GraphApiError = GraphError;

/** One line for failureReason fields: keeps Meta's code and message. */
export function describeGraphError(err: unknown): string {
  if (err instanceof GraphError) return `graph ${err.code}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is not implemented yet`);
  }
}

const ErrorShape = z.object({
  error: z.object({
    message: z.string(),
    code: z.number(),
    type: z.string().optional(),
    error_subcode: z.number().optional(),
    fbtrace_id: z.string().optional(),
  }),
});

function envelopeError(json: unknown, status: number): GraphError | null {
  const parsed = ErrorShape.safeParse(json);
  if (!parsed.success) return null;
  const e = parsed.data.error;
  return new GraphError(e.code, e.message, {
    status,
    ...(e.error_subcode !== undefined ? { subcode: e.error_subcode } : {}),
    ...(e.type !== undefined ? { type: e.type } : {}),
    ...(e.fbtrace_id !== undefined ? { fbtraceId: e.fbtrace_id } : {}),
  });
}

/** Throws GraphError when the payload is Meta's error envelope. */
function rejectErrors(json: unknown): void {
  const err = envelopeError(json, 200);
  if (err) throw err;
}

/**
 * Reads a Graph response body. A non-2xx answer or an error envelope becomes a
 * GraphError carrying the HTTP status; a body that is not JSON on a failing
 * status still yields one, so a 500 HTML page is not a parse crash.
 */
export async function readGraphResponse(res: {
  ok?: boolean;
  status?: number;
  json(): Promise<unknown>;
}): Promise<unknown> {
  const status = res.status ?? 200;
  const failed = res.ok === false;
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    if (failed) throw new GraphError(0, `instagram answered HTTP ${status} without a JSON body`, { status });
    throw new GraphError(0, "instagram answered with a body that is not JSON", { status });
  }
  const err = envelopeError(body, status);
  if (err) throw err;
  if (failed) throw new GraphError(0, `instagram answered HTTP ${status}`, { status });
  return body;
}

const RefreshShape = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
});

export function parseTokenRefresh(json: unknown): { accessToken: string; expiresInSeconds: number } {
  rejectErrors(json);
  const parsed = RefreshShape.parse(json);
  return { accessToken: parsed.access_token, expiresInSeconds: parsed.expires_in };
}

const IdShape = z.object({ id: z.string().min(1) });

export function parseContainerCreated(json: unknown): { containerId: string } {
  rejectErrors(json);
  return { containerId: IdShape.parse(json).id };
}

const StatusShape = z.object({
  status_code: z.enum(["IN_PROGRESS", "FINISHED", "ERROR", "EXPIRED", "PUBLISHED"]),
});

export function parseContainerStatus(json: unknown): ContainerStatus {
  rejectErrors(json);
  const status = StatusShape.parse(json).status_code;
  if (status === "FINISHED" || status === "PUBLISHED") return "FINISHED";
  if (status === "IN_PROGRESS") return "IN_PROGRESS";
  return "ERROR";
}

export function parsePublish(json: unknown): { igMediaId: string } {
  rejectErrors(json);
  return { igMediaId: IdShape.parse(json).id };
}

const PermalinkShape = z.object({ permalink: z.string().min(1) });

export function parsePermalink(json: unknown): { permalink: string } {
  rejectErrors(json);
  return PermalinkShape.parse(json);
}

export function parseReply(json: unknown): { replyId: string } {
  rejectErrors(json);
  return { replyId: IdShape.parse(json).id };
}

const PrivateReplyShape = z.object({ message_id: z.string().min(1) });

export function parsePrivateReply(json: unknown): { messageId: string } {
  rejectErrors(json);
  return { messageId: PrivateReplyShape.parse(json).message_id };
}

const SuccessShape = z.object({ success: z.literal(true) });

/** Hide and delete answer `{"success": true}`. */
export function parseSuccess(json: unknown): void {
  rejectErrors(json);
  SuccessShape.parse(json);
}
