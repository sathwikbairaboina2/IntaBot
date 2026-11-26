import { Inject, Injectable, Logger } from "@nestjs/common";
import { AccountRepository } from "../accounts/account.repository";
import { tokenDaysLeft } from "../accounts/token-expiry";
import { AuditRepository } from "../audit/audit.repository";
import { AppConfigService } from "../config/config.service";
import { TokenCryptoService } from "../crypto/token-crypto.service";
import { describeGraphError } from "../instagram/graph-responses";
import { INSTAGRAM_PORT, type InstagramPort } from "../instagram/instagram.port";

/** A long-lived token is refreshed once fewer than this many days are left. */
export const REFRESH_BELOW_DAYS = 15;

export interface TokenRefreshResult {
  refreshed: number;
  failed: number;
  skipped: number;
}

/**
 * Daily: renews Instagram-Login long-lived tokens that are close to expiry.
 * Live mode only. Fake mode and accounts in dry run are never touched, so
 * nothing here can reach Meta unless the operator has really gone live.
 */
@Injectable()
export class TokenRefreshProcessor {
  private readonly logger = new Logger(TokenRefreshProcessor.name);

  constructor(
    @Inject(AccountRepository) private readonly accounts: AccountRepository,
    @Inject(INSTAGRAM_PORT) private readonly instagram: InstagramPort,
    @Inject(TokenCryptoService) private readonly crypto: TokenCryptoService,
    @Inject(AuditRepository) private readonly audit: AuditRepository,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  async process(): Promise<TokenRefreshResult> {
    const result: TokenRefreshResult = { refreshed: 0, failed: 0, skipped: 0 };
    const accounts = await this.accounts.list();

    if (this.config.instagramMode !== "live") {
      result.skipped = accounts.length;
      return result;
    }

    for (const account of accounts) {
      if (
        account.status !== "ACTIVE" ||
        account.dryRun ||
        tokenDaysLeft(account.tokenExpiresAt) >= REFRESH_BELOW_DAYS
      ) {
        result.skipped += 1;
        continue;
      }

      try {
        const fresh = await this.instagram.refreshAccessToken(account);
        const now = new Date();
        await this.accounts.update(account.id, {
          accessTokenEncrypted: this.crypto.encrypt(fresh.accessToken),
          tokenExpiresAt: new Date(now.getTime() + fresh.expiresInSeconds * 1000).toISOString(),
          tokenRefreshedAt: now.toISOString(),
          tokenRefreshError: null,
        });
        await this.audit.append({ accountId: account.id, actor: "system", action: "token.refresh" });
        result.refreshed += 1;
      } catch (err) {
        const reason = describeGraphError(err);
        this.logger.warn(`token refresh for account ${account.id} failed: ${reason}`);
        await this.accounts.update(account.id, { tokenRefreshError: reason });
        await this.audit.append({
          accountId: account.id,
          actor: "system",
          action: "token.refresh-failed",
          rule: reason.slice(0, 200),
        });
        result.failed += 1;
      }
    }

    if (result.refreshed + result.failed > 0) {
      this.logger.log(`token refresh: ${result.refreshed} refreshed, ${result.failed} failed`);
    }
    return result;
  }
}
