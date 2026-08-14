import { Module } from "@nestjs/common";
import { COPY_WRITER } from "./copy-writer.port";
import { FakeCopyWriter } from "./fake-copy-writer";

// Phase 2 binds the fake. Task 11 adds the real adapter behind configuration.
@Module({
  providers: [FakeCopyWriter, { provide: COPY_WRITER, useExisting: FakeCopyWriter }],
  exports: [COPY_WRITER, FakeCopyWriter],
})
export class ContentModule {}
