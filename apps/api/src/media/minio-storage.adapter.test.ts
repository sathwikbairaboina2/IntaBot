import { beforeAll, describe, expect, it } from "vitest";
import { MinioStorageAdapter } from "./minio-storage.adapter";

const s3 = {
  endpoint: process.env.S3_ENDPOINT!,
  bucket: process.env.S3_BUCKET!,
  accessKey: process.env.S3_ACCESS_KEY!,
  secretKey: process.env.S3_SECRET_KEY!,
};

const adapter = new MinioStorageAdapter(s3);

describe("MinioStorageAdapter", () => {
  beforeAll(async () => {
    await adapter.ensureBucket();
  });

  it("stores and reads back an object", async () => {
    const key = `test/${Date.now()}-a.txt`;
    await adapter.put(key, Buffer.from("hello"), "text/plain");
    const url = await adapter.presignedUrl(key, 60);
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
  });

  it("issues a presigned URL pointing at the configured bucket", async () => {
    const url = await adapter.presignedUrl("some/key.jpg", 60);
    expect(url).toContain(s3.bucket);
    expect(url).toContain("X-Amz-Signature");
  });
});
