import { z } from "zod";

/** Meta comment-webhook payload, parsed minimally: only what moderation needs. */
const WebhookBody = z.object({
  object: z.string(),
  entry: z.array(
    z.object({
      id: z.string().min(1),
      changes: z
        .array(
          z.object({
            field: z.string(),
            value: z.unknown(),
          }),
        )
        .default([]),
    }),
  ),
});

const CommentValue = z.object({
  id: z.string().min(1),
  media: z.object({ id: z.string().min(1) }),
  from: z.object({ id: z.string().min(1), username: z.string().min(1) }),
  text: z.string(),
});

export interface WebhookCommentEvent {
  /** Dedupe key: entry id + comment id survives Meta redelivery. */
  eventId: string;
  accountIgUserId: string;
  igCommentId: string;
  igMediaId: string;
  fromIgUserId: string;
  fromUsername: string;
  text: string;
}

/** Returns the comment events in the payload; non-comment changes yield []. */
export function parseWebhookEvents(body: unknown): WebhookCommentEvent[] {
  const parsed = WebhookBody.safeParse(body);
  if (!parsed.success) return [];

  const events: WebhookCommentEvent[] = [];
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      if (change.field !== "comments") continue;
      const value = CommentValue.safeParse(change.value);
      if (!value.success) continue;
      events.push({
        eventId: `${entry.id}:${value.data.id}`,
        accountIgUserId: entry.id,
        igCommentId: value.data.id,
        igMediaId: value.data.media.id,
        fromIgUserId: value.data.from.id,
        fromUsername: value.data.from.username,
        text: value.data.text,
      });
    }
  }
  return events;
}
