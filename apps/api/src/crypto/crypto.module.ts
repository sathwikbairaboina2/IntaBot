import { Global, Module } from "@nestjs/common";
import { AppConfigService } from "../config/config.service";
import { TOKEN_ENCRYPTION_KEY, TokenCryptoService } from "./token-crypto.service";

@Global()
@Module({
  providers: [
    {
      provide: TOKEN_ENCRYPTION_KEY,
      inject: [AppConfigService],
      useFactory: (c: AppConfigService) => c.tokenEncryptionKey,
    },
    TokenCryptoService,
  ],
  exports: [TokenCryptoService],
})
export class CryptoModule {}
