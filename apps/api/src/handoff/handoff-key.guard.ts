import { createHash, timingSafeEqual } from "node:crypto";
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { AppConfigService } from "../config/config.service";

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** Shared-secret guard for the Studio handoff. No session cookie is involved. */
@Injectable()
export class HandoffKeyGuard implements CanActivate {
  constructor(@Inject(AppConfigService) private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.handoff.key;
    if (!expected) throw new ServiceUnavailableException("handoff is not configured");

    const request = context.switchToHttp().getRequest<Request>();
    const given = request.header("x-handoff-key");
    // Hashing first gives both sides the same length, which timingSafeEqual needs.
    if (!given || !timingSafeEqual(digest(given), digest(expected))) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
