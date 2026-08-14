import { Module } from "@nestjs/common";
import { MediaAssetRepository } from "./media-asset.repository";
import { MEDIA_STORAGE } from "./media-storage.port";
import { MinioStorageAdapter } from "./minio-storage.adapter";

@Module({
  providers: [
    MediaAssetRepository,
    MinioStorageAdapter,
    { provide: MEDIA_STORAGE, useExisting: MinioStorageAdapter },
  ],
  exports: [MediaAssetRepository, MEDIA_STORAGE, MinioStorageAdapter],
})
export class MediaModule {}
