import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { AppConfigService } from "../config/config.service";
import { AuthGuard, AuthedRequest, SESSION_COOKIE } from "./auth.guard";
import { PasswordService } from "./password.service";
import { SessionService } from "./session.service";
import { UserRepository } from "./user.repository";

const LoginBody = z.object({ email: z.string().email(), password: z.string().min(1) });

@Controller("auth")
export class AuthController {
  // Every dependency is injected explicitly with @Inject. esbuild, which
  // Vitest and tsx use to transform TypeScript, does not implement
  // emitDecoratorMetadata, so Nest's type-based constructor injection
  // silently resolves to undefined. Explicit tokens are the project
  // convention for that reason.
  constructor(
    @Inject(UserRepository) private readonly users: UserRepository,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  @Post("login")
  @HttpCode(200)
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const parsed = LoginBody.safeParse(body);
    if (!parsed.success) throw new UnauthorizedException();

    const user = await this.users.get(parsed.data.email);
    if (!user) throw new UnauthorizedException();

    const ok = await this.passwords.verify(user.passwordHash, parsed.data.password);
    if (!ok) throw new UnauthorizedException();

    const { token, expiresAt } = await this.sessions.create(user.email);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: this.config.nodeEnv === "production",
      expires: new Date(expiresAt),
      path: "/",
    });
    return { email: user.email };
  }

  @Post("logout")
  @HttpCode(200)
  async logout(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) await this.sessions.revoke(token);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  }

  @Get("me")
  @UseGuards(AuthGuard)
  me(@Req() req: AuthedRequest) {
    return { email: req.userEmail };
  }
}
