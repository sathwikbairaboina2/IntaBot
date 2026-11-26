import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { Account, AccountStatus, IanaTimezone, PostingWindows } from "@intabot/shared";
import { z } from "zod";
import { AuthGuard } from "../auth/auth.guard";
import { AppConfigService } from "../config/config.service";
import { TokenCryptoService } from "../crypto/token-crypto.service";
import { AccountNotFoundError, AccountRepository } from "./account.repository";
import { tokenDaysLeft } from "./token-expiry";

const CreateBody = z.object({
  name: z.string().min(1),
  igUserId: z.string().min(1),
  username: z.string().min(1),
  accessToken: z.string().min(1),
  tokenExpiresAt: z.string().datetime(),
});

const PatchBody = z.object({
  name: z.string().min(1).optional(),
  status: AccountStatus.optional(),
  dryRun: z.boolean().optional(),
  moderationPaused: z.boolean().optional(),
  replyCapPerPostPerHour: z.number().int().positive().optional(),
  replyCapPerAccountPerHour: z.number().int().positive().optional(),
  blocklist: z.array(z.string().min(1)).optional(),
  linkKeyword: z.string().min(1).optional(),
  listKeyword: z.string().min(1).optional(),
  listText: z.string().max(1000).nullable().optional(),
  timezone: IanaTimezone.optional(),
  postingWindows: PostingWindows.optional(),
});

export type AccountView = Omit<Account, "accessTokenEncrypted"> & {
  /** Whole days until the token expires; negative once it has. */
  tokenDaysLeft: number;
};

function toView(account: Account): AccountView {
  const { accessTokenEncrypted: _omitted, ...view } = account;
  return { ...view, tokenDaysLeft: tokenDaysLeft(account.tokenExpiresAt) };
}

@Controller("accounts")
@UseGuards(AuthGuard)
export class AccountsController {
  constructor(
    @Inject(AccountRepository) private readonly accounts: AccountRepository,
    @Inject(TokenCryptoService) private readonly crypto: TokenCryptoService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  @Get()
  async list(): Promise<AccountView[]> {
    return (await this.accounts.list()).map(toView);
  }

  @Get(":id")
  async get(@Param("id") id: string): Promise<AccountView> {
    const account = await this.accounts.get(id);
    if (!account) throw new NotFoundException(`account not found: ${id}`);
    return toView(account);
  }

  @Post()
  async create(@Body() body: unknown): Promise<AccountView> {
    const parsed = CreateBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);

    const account = await this.accounts.create({
      name: parsed.data.name,
      igUserId: parsed.data.igUserId,
      username: parsed.data.username,
      accessTokenEncrypted: this.crypto.encrypt(parsed.data.accessToken),
      tokenExpiresAt: parsed.data.tokenExpiresAt,
      timezone: this.config.defaultTimezone,
    });
    return toView(account);
  }

  @Patch(":id")
  async patch(@Param("id") id: string, @Body() body: unknown): Promise<AccountView> {
    const parsed = PatchBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);

    try {
      return toView(await this.accounts.update(id, parsed.data));
    } catch (err) {
      if (err instanceof AccountNotFoundError) throw new NotFoundException(err.message);
      throw err;
    }
  }
}
