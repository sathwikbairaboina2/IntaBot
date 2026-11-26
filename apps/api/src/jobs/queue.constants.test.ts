import { afterEach, describe, expect, it } from "vitest";
import { QUEUE, queuePrefix } from "./queue.constants";

const original = process.env.VITEST_WORKER_ID;
const originalPrefix = process.env.QUEUE_PREFIX;
afterEach(() => {
  if (original === undefined) delete process.env.VITEST_WORKER_ID;
  else process.env.VITEST_WORKER_ID = original;
  if (originalPrefix === undefined) delete process.env.QUEUE_PREFIX;
  else process.env.QUEUE_PREFIX = originalPrefix;
});

describe("queuePrefix", () => {
  it("isolates queues per vitest worker", () => {
    process.env.VITEST_WORKER_ID = "3";
    expect(queuePrefix()).toBe("intabot-test-w3");
  });

  it("uses the plain prefix outside tests", () => {
    delete process.env.VITEST_WORKER_ID;
    delete process.env.QUEUE_PREFIX;
    expect(queuePrefix()).toBe("intabot");
  });

  it("honours QUEUE_PREFIX outside tests and ignores a blank one", () => {
    delete process.env.VITEST_WORKER_ID;
    process.env.QUEUE_PREFIX = "intabot-e2e";
    expect(queuePrefix()).toBe("intabot-e2e");
    process.env.QUEUE_PREFIX = "";
    expect(queuePrefix()).toBe("intabot");
  });

  it("keeps the per-worker prefix even when QUEUE_PREFIX is set", () => {
    process.env.VITEST_WORKER_ID = "2";
    process.env.QUEUE_PREFIX = "intabot-e2e";
    expect(queuePrefix()).toBe("intabot-test-w2");
  });
});

describe("QUEUE", () => {
  it("names all six queues", () => {
    expect(Object.values(QUEUE)).toEqual([
      "draft",
      "publish-scan",
      "publish",
      "poll-container",
      "moderation",
      "token-refresh",
    ]);
  });
});
