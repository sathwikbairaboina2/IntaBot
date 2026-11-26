import { ExecutionContext, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { AuthGuard } from "./auth.guard";
import { PanelAuthGuard } from "./panel-auth.guard";
import type { AppConfigService } from "../config/config.service";

const KEY = "panel-key";

function context(headers: Record<string, string>): ExecutionContext {
  const request = { header: (name: string) => headers[name.toLowerCase()], cookies: {} };
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

function guard(opts: { key?: string; sessionOk: boolean }) {
  const config = { handoff: { key: opts.key } } as AppConfigService;
  const session = {
    canActivate: async () => {
      if (!opts.sessionOk) throw new UnauthorizedException();
      return true;
    },
  } as unknown as AuthGuard;
  return new PanelAuthGuard(config, session);
}

describe("PanelAuthGuard", () => {
  it("accepts the handoff key without a session", async () => {
    expect(await guard({ key: KEY, sessionOk: false }).canActivate(context({ "x-handoff-key": KEY }))).toBe(true);
  });

  it("accepts a valid session without a key", async () => {
    expect(await guard({ key: KEY, sessionOk: true }).canActivate(context({}))).toBe(true);
    expect(await guard({ sessionOk: true }).canActivate(context({}))).toBe(true);
  });

  it("refuses a wrong key even when a session would pass", async () => {
    await expect(
      guard({ key: KEY, sessionOk: true }).canActivate(context({ "x-handoff-key": "nope" })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("refuses a key when none is configured", async () => {
    await expect(
      guard({ sessionOk: false }).canActivate(context({ "x-handoff-key": KEY })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("refuses neither key nor session", async () => {
    await expect(guard({ key: KEY, sessionOk: false }).canActivate(context({}))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("does not use ServiceUnavailable: the session path stays usable without a key", async () => {
    await expect(guard({ sessionOk: false }).canActivate(context({}))).rejects.not.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
