import { Worker } from "bullmq";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { QUEUE, queuePrefix } from "../src/jobs/queue.constants";
import { drainQueues, testConnection, testQueue } from "./queue-fixture";

describe("queue infrastructure", () => {
  let worker: Worker | undefined;

  beforeEach(async () => {
    await drainQueues([QUEUE.draft]);
  });

  afterEach(async () => {
    await worker?.close();
    worker = undefined;
  });

  it("delivers a job to a worker on the same prefix", async () => {
    const seen: string[] = [];
    worker = new Worker(
      QUEUE.draft,
      async (job) => {
        seen.push(job.data.assetId as string);
      },
      { connection: testConnection, prefix: queuePrefix() },
    );

    const q = testQueue(QUEUE.draft);
    await q.add("draft", { assetId: "asset-1" });
    await q.close();

    await new Promise<void>((resolve) => {
      const started = Date.now();
      const tick = setInterval(() => {
        if (seen.length > 0 || Date.now() - started > 10_000) {
          clearInterval(tick);
          resolve();
        }
      }, 50);
    });

    expect(seen).toEqual(["asset-1"]);
  });

  it("dedupes jobs sharing a jobId", async () => {
    const q = testQueue(QUEUE.draft);
    await q.add("draft", { assetId: "a" }, { jobId: "same" });
    await q.add("draft", { assetId: "a" }, { jobId: "same" });
    expect(await q.getWaitingCount()).toBe(1);
    await q.close();
  });
});
