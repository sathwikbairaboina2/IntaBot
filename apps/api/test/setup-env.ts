// Host ports match docker-compose.yml, which is remapped away from the
// defaults because this machine runs other projects on 8000 and 9000/9001.
process.env.NODE_ENV = "test";
process.env.AWS_REGION ??= "us-east-1";
process.env.AWS_ACCESS_KEY_ID ??= "local";
process.env.AWS_SECRET_ACCESS_KEY ??= "local";
process.env.DYNAMO_ENDPOINT ??= "http://localhost:8200";
process.env.DYNAMO_TABLE_MAIN ??= "intabot_main_test";
process.env.DYNAMO_TABLE_CHECKPOINTS ??= "intabot_checkpoints_test";
process.env.REDIS_URL ??= "redis://localhost:6479";
process.env.S3_ENDPOINT ??= "http://localhost:9200";
process.env.S3_BUCKET ??= "intabot-media-test";
process.env.S3_ACCESS_KEY ??= "intabot";
process.env.S3_SECRET_KEY ??= "intabot-dev-secret";
process.env.TOKEN_ENCRYPTION_KEY ??= Buffer.alloc(32, 3).toString("base64");
process.env.SESSION_TTL_HOURS ??= "168";
