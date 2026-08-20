import { Module } from "@nestjs/common";
import { AppConfigService } from "../config/config.service";
import { TokenCryptoService } from "../crypto/token-crypto.service";
import { FakeInstagramAdapter } from "./fake-instagram.adapter";
import { GraphInstagramAdapter } from "./graph-instagram.adapter";
import { INSTAGRAM_PORT } from "./instagram.port";

@Module({
  providers: [
    FakeInstagramAdapter,
    {
      provide: INSTAGRAM_PORT,
      inject: [AppConfigService, TokenCryptoService, FakeInstagramAdapter],
      // The fake is the default; INSTAGRAM_MODE=live opts in to the real Graph
      // adapter. Live also requires META_APP_SECRET so webhooks can be
      // verified — going live with unverifiable webhooks would accept forged
      // comment events.
      useFactory: (
        config: AppConfigService,
        crypto: TokenCryptoService,
        fake: FakeInstagramAdapter,
      ) => {
        if (config.instagramMode !== "live") return fake;
        if (!config.meta.appSecret) {
          throw new Error("INSTAGRAM_MODE=live requires META_APP_SECRET");
        }
        return new GraphInstagramAdapter(config, crypto);
      },
    },
  ],
  exports: [INSTAGRAM_PORT, FakeInstagramAdapter],
})
export class InstagramModule {}
