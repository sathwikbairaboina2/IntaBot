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
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { AnyFilesInterceptor, FileInterceptor } from "@nestjs/platform-express";
import type { Account, PostFormat } from "@intabot/shared";
import type { Response } from "express";
import { z } from "zod";
import { AccountRepository } from "../accounts/account.repository";
import { AppConfigService } from "../config/config.service";
import { nextFreeSlot } from "../content/slot-planner";
import { MediaAssetRepository } from "../media/media-asset.repository";
import { MEDIA_STORAGE, type MediaStoragePort } from "../media/media-storage.port";
import { MAX_UPLOAD_BYTES, validateUpload } from "../media/upload.validation";
import { PostRepository } from "../posts/post.repository";
import { HANDOFF_HASHTAGS, HANDOFF_KEYWORD, contentCaption, jobCaption } from "./caption";
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
  keyword: HANDOFF_KEYWORD.optional(),
  accountId: z.string().min(1).optional(),
});

/** The card for carousel and reel handoffs, which come from the jobs board. */
const ContentBody = z.object({
  contentId: z.string().min(1),
  title: z.string().min(1),
  caption: z.string().min(1).optional(),
  applyUrl: z.string().url().optional(),
  keyword: HANDOFF_KEYWORD.optional(),
  accountId: z.string().min(1).optional(),
});

const SOURCE_APP = "iolar-studio";
const CONTENT_SOURCE_APP = "control-room";
const IMAGE_MIMES = new Set(["image/png", "image/jpeg"]);
const REEL_MIMES = new Set(["video/mp4", "video/quicktime"]);
export const MIN_CAROUSEL_FILES = 2;
export const MAX_CAROUSEL_FILES = 10;
/** Instagram refuses carousel images over 8 MB. */
export const MAX_CAROUSEL_IMAGE_BYTES = 8 * 1024 * 1024;
/** Above the carousel limit, so the 400 for "too many" comes from our own count. */
const MULTIPART_FILE_LIMIT = MAX_CAROUSEL_FILES + 10;
const FILE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

interface PendingPost {
  account: Account;
  format: PostFormat;
  files: Express.Multer.File[];
  caption: string;
  applyUrl?: string | undefined;
  keyword?: string | undefined;
  source: { app: string; ref: string };
  /** Idempotency key: the same claim id always answers with the same post. */
  claimId: string;
}

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
    if (!IMAGE_MIMES.has(file.mimetype)) {
      throw new BadRequestException(`card image must be PNG or JPEG, got ${file.mimetype}`);
    }
    const validation = validateUpload(file);
    if (!validation.ok) throw new BadRequestException(validation.reason);

    const card = this.parseCard(CardBody, cardJson);

    const seen = await this.handoffs.find(card.cardId);
    if (seen) return this.repeat(res, seen.accountId, seen.postId);

    const account = await this.resolveAccount(card.accountId);
    const caption = jobCaption({ ...card, keyword: card.keyword ?? account.linkKeyword });
    return this.createPending(res, {
      account,
      format: "IMAGE",
      files: [file],
      caption,
      applyUrl: card.applyUrl,
      keyword: card.keyword,
      source: { app: SOURCE_APP, ref: card.cardId },
      claimId: card.cardId,
    });
  }

  /** Two to ten PNG/JPEG slides in `files[]`, kept in the order sent. */
  @Post("carousel")
  @HttpCode(201)
  @UseInterceptors(
    AnyFilesInterceptor({
      limits: { files: MULTIPART_FILE_LIMIT, fileSize: MAX_CAROUSEL_IMAGE_BYTES },
    }),
  )
  async carousel(
    @UploadedFiles() uploaded: Express.Multer.File[] | undefined,
    @Body("card") cardJson: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const files = (uploaded ?? []).filter(
      (f) => f.fieldname === "files[]" || f.fieldname === "files",
    );
    if (files.length < MIN_CAROUSEL_FILES || files.length > MAX_CAROUSEL_FILES) {
      throw new BadRequestException(
        `a carousel takes ${MIN_CAROUSEL_FILES}-${MAX_CAROUSEL_FILES} images in files[], got ${files.length}`,
      );
    }
    for (const file of files) {
      if (!IMAGE_MIMES.has(file.mimetype)) {
        throw new BadRequestException(`carousel images must be PNG or JPEG, got ${file.mimetype}`);
      }
      const validation = validateUpload(file);
      if (!validation.ok) throw new BadRequestException(validation.reason);
    }

    return this.handoffContent(res, "CAROUSEL", files, cardJson);
  }

  /** One mp4 or mov (up to 100 MB) in `file`. */
  @Post("reel")
  @HttpCode(201)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async reel(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body("card") cardJson: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!file) throw new BadRequestException("file is required");
    if (!REEL_MIMES.has(file.mimetype)) {
      throw new BadRequestException(`reel must be mp4 or mov, got ${file.mimetype}`);
    }
    const validation = validateUpload(file);
    if (!validation.ok) throw new BadRequestException(validation.reason);

    return this.handoffContent(res, "REEL", [file], cardJson);
  }

  private async handoffContent(
    res: Response,
    format: PostFormat,
    files: Express.Multer.File[],
    cardJson: string | undefined,
  ) {
    const card = this.parseCard(ContentBody, cardJson);

    // Namespaced so a content id can never collide with a job-card id.
    const claimId = `content:${card.contentId}`;
    const seen = await this.handoffs.find(claimId);
    if (seen) return this.repeat(res, seen.accountId, seen.postId);

    const account = await this.resolveAccount(card.accountId);
    const caption =
      card.caption ??
      contentCaption({ title: card.title, keyword: card.keyword ?? account.linkKeyword });
    return this.createPending(res, {
      account,
      format,
      files,
      caption,
      applyUrl: card.applyUrl,
      keyword: card.keyword,
      source: { app: CONTENT_SOURCE_APP, ref: card.contentId },
      claimId,
    });
  }

  private async createPending(res: Response, pending: PendingPost) {
    const { account, files } = pending;

    const safeId = pending.claimId.replace(/[^A-Za-z0-9_-]/g, "_");
    const assetIds: string[] = [];
    for (const [index, file] of files.entries()) {
      const key = `${account.id}/${Date.now()}-handoff-${safeId}-${index + 1}.${FILE_EXTENSIONS[file.mimetype]}`;
      await this.storage.put(key, file.buffer, file.mimetype);
      const asset = await this.assets.create({
        accountId: account.id,
        storageKey: key,
        contentType: file.mimetype,
        sizeBytes: file.size,
      });
      assetIds.push(asset.id);
    }

    const now = new Date();
    const scheduledAt = nextFreeSlot({
      now,
      timezone: account.timezone,
      windows: account.postingWindows,
      takenAt: await this.posts.listScheduledAfter(account.id, now.toISOString()),
    });

    const draft = await this.posts.create({
      accountId: account.id,
      format: pending.format,
      mediaAssetIds: assetIds,
      caption: pending.caption,
      hashtags: HANDOFF_HASHTAGS,
      scheduledAt,
      ...(pending.applyUrl !== undefined ? { applyUrl: pending.applyUrl } : {}),
      ...(pending.keyword !== undefined ? { keyword: pending.keyword } : {}),
      source: pending.source,
    });
    const post = await this.posts.transition({
      accountId: account.id,
      postId: draft.id,
      expectedStatus: "DRAFT",
      expectedVersion: draft.version,
      nextStatus: "PENDING_APPROVAL",
    });

    const claim = await this.handoffs.claim(pending.claimId, {
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

  private parseCard<T extends z.ZodTypeAny>(schema: T, cardJson: string | undefined): z.infer<T> {
    if (!cardJson) throw new BadRequestException("card is required");
    let raw: unknown;
    try {
      raw = JSON.parse(cardJson);
    } catch {
      throw new BadRequestException("card must be valid JSON");
    }
    const parsed = schema.safeParse(raw);
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
