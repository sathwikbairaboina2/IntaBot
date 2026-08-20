// Host ports match docker-compose.yml, which is remapped away from the
// defaults because this machine runs other projects on 8000 and 9000/9001.
process.env.NODE_ENV = "test";
process.env.AWS_REGION ??= "us-east-1";
process.env.AWS_ACCESS_KEY_ID ??= "local";
process.env.AWS_SECRET_ACCESS_KEY ??= "local";
process.env.DYNAMO_ENDPOINT ??= "http://localhost:8200";
process.env.REDIS_URL ??= "redis://localhost:6479";
process.env.S3_ENDPOINT ??= "http://localhost:9200";
process.env.S3_BUCKET ??= "intabot-media-test";
process.env.S3_ACCESS_KEY ??= "intabot";
process.env.S3_SECRET_KEY ??= "intabot-dev-secret";
process.env.TOKEN_ENCRYPTION_KEY ??= Buffer.alloc(32, 3).toString("base64");
process.env.SESSION_TTL_HOURS ??= "168";
process.env.META_APP_SECRET ??= "test-app-secret";
process.env.META_WEBHOOK_VERIFY_TOKEN ??= "test-verify-token";

// Tables are scoped per Vitest worker. Test files that run concurrently land
// in different workers and therefore different tables, so one file's
// resetTables() can never delete rows another file is still using (which
// showed up as spurious 401s when a session row vanished mid-test). Files
// that share a worker run sequentially, so sharing a table is safe.
const worker = process.env.VITEST_WORKER_ID ?? "0";
process.env.DYNAMO_TABLE_MAIN = `intabot_main_test_w${worker}`;
process.env.DYNAMO_TABLE_CHECKPOINTS = `intabot_ckpt_test_w${worker}`;
