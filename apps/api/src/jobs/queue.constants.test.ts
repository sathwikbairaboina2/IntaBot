import { afterEach, describe, expect, it } from "vitest";
import { QUEUE, queuePrefix } from "./queue.constants";

const original = process.env.VITEST_WORKER_ID;
afterEach(() => {
  if (original === undefined) delete process.env.VITEST_WORKER_ID;
  else process.env.VITEST_WORKER_ID = original;
});

describe("queuePrefix", () => {
  it("isolates queues per vitest worker", () => {
    process.env.VITEST_WORKER_ID = "3";
    expect(queuePrefix()).toBe("intabot-test-w3");
  });

  it("uses the plain prefix outside tests", () => {
    delete process.env.VITEST_WORKER_ID;
    expect(queuePrefix()).toBe("intabot");
  });
});

describe("QUEUE", () => {
  it("names all four queues", () => {
    expect(Object.values(QUEUE)).toEqual(["draft", "publish-scan", "publish", "poll-container"]);
  });
});
