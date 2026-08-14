import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { PasswordService } from "../auth/password.service";
import { UserRepository } from "../auth/user.repository";
import { ensureTables } from "../dynamo/bootstrap";
import { AppConfigService } from "../config/config.service";
import { DYNAMO_RAW } from "../dynamo/dynamo.module";
import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";

async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    console.error("usage: pnpm --filter @intabot/api run create-user <email> <password>");
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error"] });
  try {
    // Creating an operator is usually the first thing done on a fresh
    // install, so make sure the tables exist rather than failing on a
    // ResourceNotFoundException.
    const config = app.get(AppConfigService);
    const raw = app.get<DynamoDBClient>(DYNAMO_RAW);
    await ensureTables(raw, {
      main: config.dynamo.tableMain,
      checkpoints: config.dynamo.tableCheckpoints,
    });

    const users = app.get(UserRepository);
    const passwords = app.get(PasswordService);
    const user = await users.create(email, await passwords.hash(password));
    console.log(`created operator: ${user.email}`);
  } finally {
    await app.close();
  }
}

void main();
