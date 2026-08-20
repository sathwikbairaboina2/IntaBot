import { z } from "zod";
import type { ContainerStatus } from "./instagram.port";

export class GraphApiError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
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
  }),
});

/** Throws GraphApiError when the payload is Meta's error envelope. */
function rejectErrors(json: unknown): void {
  const parsed = ErrorShape.safeParse(json);
  if (parsed.success) {
    throw new GraphApiError(parsed.data.error.code, parsed.data.error.message);
  }
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
