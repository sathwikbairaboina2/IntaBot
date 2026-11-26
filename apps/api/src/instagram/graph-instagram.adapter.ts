import { Inject, Injectable } from "@nestjs/common";
import type { Account } from "@intabot/shared";
import { AppConfigService } from "../config/config.service";
import { TokenCryptoService } from "../crypto/token-crypto.service";
import {
  NotImplementedError,
  parseContainerCreated,
  parseContainerStatus,
  parsePermalink,
  parsePrivateReply,
  parsePublish,
  parseReply,
  parseTokenRefresh,
  readGraphResponse,
  parseSuccess,
} from "./graph-responses";
import type {
  ContainerInput,
  ContainerStatus,
  DateRange,
  InsightPoint,
  InstagramPort,
  PrivateReplyResult,
  PublishResult,
  RefreshedToken,
  ReplyResult,
} from "./instagram.port";

export const GRAPH_BASE_URL = "https://graph.instagram.com";

/** Unset keeps the unversioned URLs; INSTAGRAM_GRAPH_VERSION (e.g. v21.0) pins one. */
export function graphBaseUrl(version: string | undefined): string {
  return version ? `${GRAPH_BASE_URL}/${version}` : GRAPH_BASE_URL;
}

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
    return readGraphResponse(res);
  }

  private async postJson(path: string, token: string, body: unknown): Promise<unknown> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    return readGraphResponse(res);
  }

  private async delete(path: string, params: Record<string, string>): Promise<unknown> {
    const query = new URLSearchParams(params).toString();
    const res = await this.fetchImpl(`${this.baseUrl}${path}?${query}`, { method: "DELETE" });
    return readGraphResponse(res);
  }

  private async get(path: string, params: Record<string, string>): Promise<unknown> {
    const query = new URLSearchParams(params).toString();
    const res = await this.fetchImpl(`${this.baseUrl}${path}?${query}`);
    return readGraphResponse(res);
  }

  async createContainer(
    account: Account,
    input: ContainerInput,
  ): Promise<{ containerId: string }> {
    const body: Record<string, string> = { access_token: this.token(account) };

    if (input.format === "CAROUSEL") {
      // The carousel container names its already-finished children, in order.
      if (!input.childContainerIds?.length) {
        throw new Error("a carousel container needs its children");
      }
      body.media_type = "CAROUSEL";
      body.children = input.childContainerIds.join(",");
      body.caption = input.caption;
    } else if (input.isCarouselItem) {
      // A slide carries no caption; the carousel container does.
      body.image_url = input.mediaUrl;
      body.is_carousel_item = "true";
    } else if (input.format === "IMAGE") {
      body.caption = input.caption;
      body.image_url = input.mediaUrl;
    } else {
      body.caption = input.caption;
      body.media_type = input.format === "STORY" ? "STORIES" : "REELS";
      body.video_url = input.mediaUrl;
      if (input.format === "REEL") body.share_to_feed = "true";
    }

    return parseContainerCreated(await this.post(`/${account.igUserId}/media`, body));
  }

  async refreshAccessToken(account: Account): Promise<RefreshedToken> {
    // The refresh endpoint is never versioned.
    const query = new URLSearchParams({
      grant_type: "ig_refresh_token",
      access_token: this.token(account),
    }).toString();
    const res = await this.fetchImpl(`${GRAPH_BASE_URL}/refresh_access_token?${query}`);
    return parseTokenRefresh(await readGraphResponse(res));
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

  async sendPrivateReply(
    account: Account,
    commentId: string,
    text: string,
  ): Promise<PrivateReplyResult> {
    return parsePrivateReply(
      await this.postJson(`/${account.igUserId}/messages`, this.token(account), {
        recipient: { comment_id: commentId },
        message: { text },
      }),
    );
  }

  async hideComment(account: Account, commentId: string, hidden: boolean): Promise<void> {
    parseSuccess(
      await this.post(`/${commentId}`, {
        access_token: this.token(account),
        hide: hidden ? "true" : "false",
      }),
    );
  }

  async deleteComment(account: Account, commentId: string): Promise<void> {
    parseSuccess(await this.delete(`/${commentId}`, { access_token: this.token(account) }));
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
