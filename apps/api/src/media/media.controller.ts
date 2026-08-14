import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Queue } from "bullmq";
import { AccountRepository } from "../accounts/account.repository";
import { AuthGuard } from "../auth/auth.guard";
import { DRAFT_QUEUE } from "../jobs/queue.constants";
import { MediaAssetRepository } from "./media-asset.repository";
import { MEDIA_STORAGE, type MediaStoragePort } from "./media-storage.port";
import { MAX_UPLOAD_BYTES, validateUpload } from "./upload.validation";

@Controller("media")
@UseGuards(AuthGuard)
export class MediaController {
  constructor(
    @Inject(MediaAssetRepository) private readonly assets: MediaAssetRepository,
    @Inject(AccountRepository) private readonly accounts: AccountRepository,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStoragePort,
    @Inject(DRAFT_QUEUE) private readonly draftQueue: Queue,
  ) {}

  @Post()
  @HttpCode(202)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body("accountId") accountId: string | undefined,
  ) {
    if (!file) throw new BadRequestException("file is required");
    if (!accountId) throw new BadRequestException("accountId is required");

    const account = await this.accounts.get(accountId);
    if (!account) throw new NotFoundException(`account not found: ${accountId}`);

    const validation = validateUpload(file);
    if (!validation.ok) throw new BadRequestException(validation.reason);

    const key = `${accountId}/${Date.now()}-${file.originalname}`;
    await this.storage.put(key, file.buffer, file.mimetype);

    const asset = await this.assets.create({
      accountId,
      storageKey: key,
      contentType: file.mimetype,
      sizeBytes: file.size,
    });

    await this.draftQueue.add(
      "draft",
      { accountId, assetId: asset.id, format: validation.format },
      { jobId: `draft:${asset.id}`, attempts: 3, backoff: { type: "exponential", delay: 2000 } },
    );

    return { assetId: asset.id, format: validation.format };
  }
}
