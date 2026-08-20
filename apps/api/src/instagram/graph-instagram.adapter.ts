import { Inject, Injectable } from "@nestjs/common";
import type { Account } from "@intabot/shared";
import { AppConfigService } from "../config/config.service";
import { TokenCryptoService } from "../crypto/token-crypto.service";
import {
  NotImplementedError,
  parseContainerCreated,
  parseContainerStatus,
  parsePermalink,
  parsePublish,
  parseReply,
} from "./graph-responses";
import type {
  ContainerInput,
  ContainerStatus,
  DateRange,
  InsightPoint,
  InstagramPort,
  PublishResult,
  ReplyResult,
} from "./instagram.port";

export const GRAPH_BASE_URL = "https://graph.instagram.com";

/**
 * Real Instagram Graph adapter. The account token is decrypted per call and
 * never logged; the parsing layer is pure and contract-tested against
 * recorded fixtures, which is what pins Meta's response shapes without live
 * credentials. Selected via INSTAGRAM_MODE=live; the fake stays the default.
 */
@Injectable()
export class GraphInstagramAdapter implements InstagramPort {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(
    @Inject(AppConfigService) _config: AppConfigService,
    @Inject(TokenCryptoService) private readonly crypto: TokenCryptoService,
    fetchImpl: typeof fetch = fetch,
    baseUrl: string = GRAPH_BASE_URL,
  ) {
    this.fetchImpl = fetchImpl;
    this.baseUrl = baseUrl;
  }

  private token(account: Account): string {
    return this.crypto.decrypt(account.accessTokenEncrypted);
  }

  private async post(path: string, body: Record<string, string>): Promise<unknown> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });
    return res.json();
  }

  private async get(path: string, params: Record<string, string>): Promise<unknown> {
    const query = new URLSearchParams(params).toString();
    const res = await this.fetchImpl(`${this.baseUrl}${path}?${query}`);
    return res.json();
  }

  async createContainer(
    account: Account,
    input: ContainerInput,
  ): Promise<{ containerId: string }> {
    if (input.format === "CAROUSEL") {
      // Child containers are deferred; single image / reel / story only.
      throw new NotImplementedError("carousel publishing");
    }

    const body: Record<string, string> = {
      access_token: this.token(account),
      caption: input.caption,
    };
    if (input.format === "IMAGE") {
      body.image_url = input.mediaUrl;
    } else {
      body.media_type = input.format === "STORY" ? "STORIES" : "REELS";
      body.video_url = input.mediaUrl;
    }

    return parseContainerCreated(await this.post(`/${account.igUserId}/media`, body));
  }

  async getContainerStatus(account: Account, containerId: string): Promise<ContainerStatus> {
    return parseContainerStatus(
      await this.get(`/${containerId}`, {
        fields: "status_code",
        access_token: this.token(account),
      }),
    );
  }

  async publishContainer(account: Account, containerId: string): Promise<PublishResult> {
    const { igMediaId } = parsePublish(
      await this.post(`/${account.igUserId}/media_publish`, {
        access_token: this.token(account),
        creation_id: containerId,
      }),
    );
    const { permalink } = parsePermalink(
      await this.get(`/${igMediaId}`, {
        fields: "permalink",
        access_token: this.token(account),
      }),
    );
    return { igMediaId, permalink };
  }

  async replyToComment(account: Account, commentId: string, text: string): Promise<ReplyResult> {
    return parseReply(
      await this.post(`/${commentId}/replies`, {
        access_token: this.token(account),
        message: text,
      }),
    );
  }

  async getAccountInsights(
    _account: Account,
    _metrics: string[],
    _range: DateRange,
  ): Promise<InsightPoint[]> {
    throw new NotImplementedError("account insights"); // Phase 4
  }

  async getMediaInsights(_account: Account, _igMediaId: string): Promise<InsightPoint[]> {
    throw new NotImplementedError("media insights"); // Phase 4
  }
}
