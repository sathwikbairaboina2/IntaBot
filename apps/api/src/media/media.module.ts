import { Module } from "@nestjs/common";
import { AccountsModule } from "../accounts/accounts.module";
import { MediaAssetRepository } from "./media-asset.repository";
import { MEDIA_STORAGE } from "./media-storage.port";
import { MediaController } from "./media.controller";
import { MinioStorageAdapter } from "./minio-storage.adapter";

@Module({
  imports: [AccountsModule],
  controllers: [MediaController],
  providers: [
    MediaAssetRepository,
    MinioStorageAdapter,
    { provide: MEDIA_STORAGE, useExisting: MinioStorageAdapter },
  ],
  exports: [MediaAssetRepository, MEDIA_STORAGE, MinioStorageAdapter],
})
export class MediaModule {}
