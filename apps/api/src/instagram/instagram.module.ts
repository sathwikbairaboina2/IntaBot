import { Module } from "@nestjs/common";
import { FakeInstagramAdapter } from "./fake-instagram.adapter";
import { INSTAGRAM_PORT } from "./instagram.port";

// Phase 1 always binds the fake. Phase 2 adds the real adapter and selects
// between them based on configuration.
@Module({
  providers: [FakeInstagramAdapter, { provide: INSTAGRAM_PORT, useExisting: FakeInstagramAdapter }],
  exports: [INSTAGRAM_PORT, FakeInstagramAdapter],
})
export class InstagramModule {}
