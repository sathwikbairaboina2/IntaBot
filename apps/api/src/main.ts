import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";
import { AppConfigService } from "./config/config.service";

async function bootstrap() {
  // rawBody is required for Instagram webhook HMAC verification in phase 3.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.use(cookieParser());
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:3100", credentials: true });
  const config = app.get(AppConfigService);
  await app.listen(config.port);
}

void bootstrap();
