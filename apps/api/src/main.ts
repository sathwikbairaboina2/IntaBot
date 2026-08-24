import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";
import { AppConfigService } from "./config/config.service";

async function bootstrap() {
  // rawBody is required for Instagram webhook HMAC verification in phase 3.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.use(cookieParser());
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:3100", credentials: true });
  const swaggerConfig = new DocumentBuilder()
    .setTitle("@intabot/api")
    .setDescription("IntaBot API")
    .setVersion("1.0")
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("docs", app, swaggerDocument);

  const config = app.get(AppConfigService);
  await app.listen(config.port);
}

void bootstrap();
