import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  Inject,
  InternalServerErrorException,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Account } from "@intabot/shared";
import type { Response } from "express";
import { z } from "zod";
import { AccountRepository } from "../accounts/account.repository";
import { AppConfigService } from "../config/config.service";
import { nextFreeSlot } from "../content/slot-planner";
import { MediaAssetRepository } from "../media/media-asset.repository";
import { MEDIA_STORAGE, type MediaStoragePort } from "../media/media-storage.port";
import { MAX_UPLOAD_BYTES, validateUpload } from "../media/upload.validation";
import { PostRepository } from "../posts/post.repository";
import { HANDOFF_HASHTAGS, jobCaption } from "./caption";
import { HandoffKeyGuard } from "./handoff-key.guard";
import { HandoffRepository } from "./handoff.repository";

const CardBody = z.object({
  cardId: z.string().min(1),
  role: z.string().min(1),
  company: z.string().min(1),
  experience: z.string().min(1),
  location: z.string().min(1),
  eligibility: z.string().min(1),
  applyUrl: z.string().url(),
  accountId: z.string().min(1).optional(),
});

const SOURCE_APP = "iolar-studio";
const CARD_MIMES = new Set(["image/png", "image/jpeg"]);

@Controller("handoff")
@UseGuards(HandoffKeyGuard)
export class HandoffController {
  constructor(
    @Inject(AppConfigService) private readonly config: AppConfigService,
    @Inject(AccountRepository) private readonly accounts: AccountRepository,
    @Inject(PostRepository) private readonly posts: PostRepository,
    @Inject(MediaAssetRepository) private readonly assets: MediaAssetRepository,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStoragePort,
    @Inject(HandoffRepository) private readonly handoffs: HandoffRepository,
  ) {}

  @Post("job-card")
  @HttpCode(201)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async jobCard(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body("card") cardJson: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!file) throw new BadRequestException("file is required");
    if (!CARD_MIMES.has(file.mimetype)) {
      throw new BadRequestException(`card image must be PNG or JPEG, got ${file.mimetype}`);
    }
    const validation = validateUpload(file);
    if (!validation.ok) throw new BadRequestException(validation.reason);

    const card = this.parseCard(cardJson);

    const seen = await this.handoffs.find(card.cardId);
    if (seen) return this.repeat(res, seen.accountId, seen.postId);

    const account = await this.resolveAccount(card.accountId);

    const ext = file.mimetype === "image/png" ? "png" : "jpg";
    const safeId = card.cardId.replace(/[^A-Za-z0-9_-]/g, "_");
    const key = `${account.id}/${Date.now()}-handoff-${safeId}.${ext}`;
    await this.storage.put(key, file.buffer, file.mimetype);
    const asset = await this.assets.create({
      accountId: account.id,
      storageKey: key,
      contentType: file.mimetype,
      sizeBytes: file.size,
    });

    const caption = jobCaption({ ...card, keyword: account.linkKeyword });
    const now = new Date();
    const scheduledAt = nextFreeSlot({
      now,
      timezone: account.timezone,
      windows: account.postingWindows,
      takenAt: await this.posts.listScheduledAfter(account.id, now.toISOString()),
    });

    const draft = await this.posts.create({
      accountId: account.id,
      format: "IMAGE",
      mediaAssetIds: [asset.id],
      caption,
      hashtags: HANDOFF_HASHTAGS,
      scheduledAt,
      applyUrl: card.applyUrl,
      source: { app: SOURCE_APP, ref: card.cardId },
    });
    const post = await this.posts.transition({
      accountId: account.id,
      postId: draft.id,
      expectedStatus: "DRAFT",
      expectedVersion: draft.version,
      nextStatus: "PENDING_APPROVAL",
    });

    const claim = await this.handoffs.claim(card.cardId, {
      accountId: account.id,
      postId: post.id,
    });
    if (!claim.won) {
      // A concurrent request for the same card won; answer with its post.
      return this.repeat(res, claim.existing.accountId, claim.existing.postId);
    }

    return {
      postId: post.id,
      accountId: account.id,
      status: post.status,
      caption: post.caption,
      created: true,
    };
  }

  private parseCard(cardJson: string | undefined): z.infer<typeof CardBody> {
    if (!cardJson) throw new BadRequestException("card is required");
    let raw: unknown;
    try {
      raw = JSON.parse(cardJson);
    } catch {
      throw new BadRequestException("card must be valid JSON");
    }
    const parsed = CardBody.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return parsed.data;
  }

  private async repeat(res: Response, accountId: string, postId: string) {
    const post = await this.posts.get(accountId, postId);
    if (!post) throw new InternalServerErrorException(`handoff post missing: ${postId}`);
    res.status(200);
    return {
      postId: post.id,
      accountId: post.accountId,
      status: post.status,
      caption: post.caption,
      created: false,
    };
  }

  private async resolveAccount(requested: string | undefined): Promise<Account> {
    const wanted = requested ?? this.config.handoff.accountId;
    if (wanted) {
      const account = await this.accounts.get(wanted);
      if (!account) throw new ConflictException(`handoff account not found: ${wanted}`);
      if (account.status !== "ACTIVE") {
        throw new ConflictException(`handoff account is not active: ${wanted}`);
      }
      return account;
    }
    const active = (await this.accounts.list()).filter((a) => a.status === "ACTIVE");
    if (active.length === 0) throw new ConflictException("no active account to hand off to");
    if (active.length > 1) {
      throw new ConflictException(
        "several active accounts: name one in the card or set HANDOFF_ACCOUNT_ID",
      );
    }
    return active[0]!;
  }
}
