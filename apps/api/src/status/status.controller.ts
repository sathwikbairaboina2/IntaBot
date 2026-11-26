import { Controller, Get, Inject, UseGuards } from "@nestjs/common";
import { PanelAuthGuard } from "../auth/panel-auth.guard";
import { AppConfigService } from "../config/config.service";
import { LaunchStatus, launchStatus } from "./launch-status";

@Controller("status")
@UseGuards(PanelAuthGuard)
export class StatusController {
  constructor(@Inject(AppConfigService) private readonly config: AppConfigService) {}

  /** What the control room's launch readiness card cannot read from the accounts alone. */
  @Get("launch")
  launch(): LaunchStatus {
    return launchStatus({
      instagramMode: this.config.instagramMode,
      instagramGraphVersion: this.config.instagramGraphVersion,
      defaultTimezone: this.config.defaultTimezone,
      s3: this.config.s3,
      meta: this.config.meta,
    });
  }
}
