export const QUEUE = {
  draft: "draft",
  publishScan: "publish-scan",
  publish: "publish",
  pollContainer: "poll-container",
  moderation: "moderation",
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

/**
 * Redis is shared state. Prefixing per Vitest worker keeps concurrent test
 * files from consuming each other's jobs, the same way DynamoDB table names
 * are scoped by VITEST_WORKER_ID.
 */
export function queuePrefix(): string {
  const worker = process.env.VITEST_WORKER_ID;
  if (worker) return `intabot-test-w${worker}`;
  // A second local instance sets QUEUE_PREFIX so it never shares jobs with the
  // first. Read here (not via AppConfig) because the reply caps use it too.
  return process.env.QUEUE_PREFIX || "intabot";
}

export const REDIS_CONNECTION = Symbol("REDIS_CONNECTION");
export const DRAFT_QUEUE = Symbol("DRAFT_QUEUE");
export const PUBLISH_SCAN_QUEUE = Symbol("PUBLISH_SCAN_QUEUE");
export const PUBLISH_QUEUE = Symbol("PUBLISH_QUEUE");
export const POLL_QUEUE = Symbol("POLL_QUEUE");
export const MODERATION_QUEUE = Symbol("MODERATION_QUEUE");
