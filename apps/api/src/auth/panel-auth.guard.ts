import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { AppConfigService } from "../config/config.service";
import { handoffKeyMatches } from "../handoff/handoff-key.guard";
import { AuthGuard } from "./auth.guard";

/**
 * Either door is enough: the operator's session cookie, or the control room's
 * server-to-server handoff key (x-handoff-key, HANDOFF_KEY). A key that is
 * presented but wrong is refused outright; it never falls back to a session.
 */
@Injectable()
export class PanelAuthGuard implements CanActivate {
  constructor(
    @Inject(AppConfigService) private readonly config: AppConfigService,
    @Inject(AuthGuard) private readonly session: AuthGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const given = request.header("x-handoff-key");
    if (given !== undefined) {
      const expected = this.config.handoff.key;
      if (expected && handoffKeyMatches(given, expected)) return true;
      throw new UnauthorizedException();
    }
    return this.session.canActivate(context);
  }
}
