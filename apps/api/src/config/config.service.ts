import { Injectable } from "@nestjs/common";
import { AppConfig, parseEnv } from "./env.schema";

@Injectable()
export class AppConfigService {
  private readonly config: AppConfig = parseEnv(process.env);

  get port() { return this.config.port; }
  get nodeEnv() { return this.config.nodeEnv; }
  get dynamo() { return this.config.dynamo; }
  get redisUrl() { return this.config.redisUrl; }
  get s3() { return this.config.s3; }
  get tokenEncryptionKey() { return this.config.tokenEncryptionKey; }
  get session() { return this.config.session; }
  get meta() { return this.config.meta; }
  get anthropicApiKey() { return this.config.anthropicApiKey; }
  get instagramMode() { return this.config.instagramMode; }
  get instagramGraphVersion() { return this.config.instagramGraphVersion; }
  get defaultTimezone() { return this.config.defaultTimezone; }
  get llmProvider() { return this.config.llmProvider; }
  get ollama() { return this.config.ollama; }
  get handoff() { return this.config.handoff; }
  get queuePrefix() { return this.config.queuePrefix; }
  get publishScanIntervalMs() { return this.config.publishScanIntervalMs; }
}
