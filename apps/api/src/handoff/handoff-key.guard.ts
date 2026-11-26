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

/** Timing-safe comparison of a presented handoff key with the configured one. */
export function handoffKeyMatches(given: string, expected: string): boolean {
  // Hashing first gives both sides the same length, which timingSafeEqual needs.
  return timingSafeEqual(digest(given), digest(expected));
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
    if (!given || !handoffKeyMatches(given, expected)) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
