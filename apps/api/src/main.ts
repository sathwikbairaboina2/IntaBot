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
  const config = app.get(AppConfigService);

  // Swagger UI at /docs, JSON at /docs-json. Auth here is a session cookie, not
  // a bearer token: "Try it out" works only after POST /auth/login has been run
  // from the same browser, because the cookie is httpOnly and Swagger UI cannot
  // set it. Off in production — the operator dashboard is the only intended
  // client and an unauthenticated route inventory is not worth publishing.
  if (config.nodeEnv !== "production") {
    const swaggerConfig = new DocumentBuilder()
      .setTitle("@intabot/api")
      .setDescription("Self-hosted agentic Instagram management for Business accounts")
      .setVersion("1.0")
      .addCookieAuth("intabot_session", { type: "apiKey", in: "cookie" }, "session")
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup("docs", app, document, {
      swaggerOptions: { persistAuthorization: true, withCredentials: true },
    });
  }

  await app.listen(config.port);
}

void bootstrap();
