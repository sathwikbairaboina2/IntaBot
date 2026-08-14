import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { SessionService } from "./session.service";

export const SESSION_COOKIE = "intabot_session";

export interface AuthedRequest extends Request {
  userEmail?: string;
  cookies: Record<string, string | undefined>;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(SessionService) private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const token = request.cookies?.[SESSION_COOKIE];
    if (!token) throw new UnauthorizedException();

    const email = await this.sessions.verify(token);
    if (!email) throw new UnauthorizedException();

    request.userEmail = email;
    return true;
  }
}
