import { Queue } from "bullmq";
import IORedis from "ioredis";
import { queuePrefix } from "../src/jobs/queue.constants";

export const testConnection = new IORedis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,
});

export function testQueue(name: string): Queue {
  return new Queue(name, { connection: testConnection, prefix: queuePrefix() });
}

/** Removes every job from the named queues. Call in beforeEach. */
export async function drainQueues(names: string[]): Promise<void> {
  for (const name of names) {
    const q = testQueue(name);
    await q.obliterate({ force: true });
    await q.close();
  }
}
