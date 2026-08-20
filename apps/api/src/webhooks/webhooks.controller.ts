import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
  type RawBodyRequest,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { Queue } from "bullmq";
import { AccountRepository } from "../accounts/account.repository";
import { AppConfigService } from "../config/config.service";
import { MODERATION_QUEUE } from "../jobs/queue.constants";
import { verifySignature } from "./signature";
import { parseWebhookEvents } from "./webhook-payload";
import { WebhookSeenRepository } from "./webhook-seen.repository";

@Controller("webhooks/instagram")
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    @Inject(AppConfigService) private readonly config: AppConfigService,
    @Inject(WebhookSeenRepository) private readonly seen: WebhookSeenRepository,
    @Inject(AccountRepository) private readonly accounts: AccountRepository,
    @Inject(MODERATION_QUEUE) private readonly moderationQueue: Queue,
  ) {}

  /** Meta's one-time subscription verification challenge. */
  @Get()
  verify(
    @Query("hub.mode") mode: string | undefined,
    @Query("hub.verify_token") token: string | undefined,
    @Query("hub.challenge") challenge: string | undefined,
    @Res() res: Response,
  ): void {
    const expected = this.config.meta.webhookVerifyToken;
    if (!expected) throw new ServiceUnavailableException("webhooks are not configured");
    if (mode !== "subscribe" || token !== expected || !challenge) {
      res.status(403).send("verification failed");
      return;
    }
    res.status(200).send(challenge);
  }

  /**
   * Verify, dedupe, enqueue, 200 — nothing else. Meta retries slow or non-2xx
   * deliveries, so every piece of real work happens in the moderation worker.
   */
  @Post()
  @HttpCode(200)
  async receive(@Req() req: RawBodyRequest<Request>): Promise<{ received: number }> {
    const appSecret = this.config.meta.appSecret;
    if (!appSecret || !this.config.meta.webhookVerifyToken) {
      throw new ServiceUnavailableException("webhooks are not configured");
    }

    const header = req.headers["x-hub-signature-256"] as string | undefined;
    if (!verifySignature(req.rawBody, header, appSecret)) {
      // Reject before parsing, logging content, or enqueueing anything.
      this.logger.warn(`invalid webhook signature from ${req.ip}`);
      throw new UnauthorizedException("invalid signature");
    }

    const events = parseWebhookEvents(req.body);
    let enqueued = 0;
    for (const event of events) {
      if (!(await this.seen.markSeen(event.eventId))) continue; // redelivery

      const account = await this.accounts.findByIgUserId(event.accountIgUserId);
      if (!account) {
        this.logger.warn(`webhook for unknown ig user ${event.accountIgUserId}`);
        continue;
      }

      await this.moderationQueue.add(
        "moderate",
        {
          accountId: account.id,
          igCommentId: event.igCommentId,
          igMediaId: event.igMediaId,
          fromIgUserId: event.fromIgUserId,
          fromUsername: event.fromUsername,
          text: event.text,
        },
        {
          jobId: `mod:${event.igCommentId}`,
          attempts: 3,
          backoff: { type: "exponential", delay: 2000 },
        },
      );
      enqueued += 1;
    }
    return { received: enqueued };
  }
}
