import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { AccountRepository } from "../src/accounts/account.repository";
import { PasswordService } from "../src/auth/password.service";
import { UserRepository } from "../src/auth/user.repository";
import { AppConfigService } from "../src/config/config.service";
import { MediaAssetRepository } from "../src/media/media-asset.repository";
import { PostRepository } from "../src/posts/post.repository";
import { resetTables } from "./dynamo-fixture";

const KEY = "handoff-test-key";
// A 1x1 PNG: enough for the content-type check, which is by mimetype.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const card = {
  cardId: "card-1",
  role: "Backend Engineer",
  company: "Acme",
  experience: "2-4 yrs",
  location: "Bengaluru",
  eligibility: "B.Tech 2022-2024",
  applyUrl: "https://aiiolar.com/jobs?job=acme-backend",
};

const EXPECTED_CAPTION = [
  "Backend Engineer at Acme",
  "",
  "Experience: 2-4 yrs",
  "Location: Bengaluru",
  "Eligibility: B.Tech 2022-2024",
  "",
  "Apply: https://aiiolar.com/jobs?job=acme-backend",
  "Comment LINK and we'll DM you the link.",
].join("\n");

async function makeApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.use(cookieParser());
  await app.init();
  return app;
}

function newAccount(app: INestApplication, name = "Studio Nord", igUserId = "1784140") {
  return app.get(AccountRepository).create({
    name,
    igUserId,
    username: name.toLowerCase().replace(/\s/g, ""),
    accessTokenEncrypted: "v1:a:b:c",
    tokenExpiresAt: "2026-10-13T00:00:00.000Z",
  });
}

describe("handoff without a key configured", () => {
  let app: INestApplication;

  beforeAll(async () => {
    delete process.env.HANDOFF_KEY;
    app = await makeApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it("answers 503", async () => {
    await request(app.getHttpServer())
      .post("/handoff/job-card")
      .set("x-handoff-key", KEY)
      .field("card", JSON.stringify(card))
      .attach("file", PNG, { filename: "c.png", contentType: "image/png" })
      .expect(503);
  });
});

describe("handoff", () => {
  let app: INestApplication;
  let accountId: string;

  function send(opts: { key?: string | null; cardJson?: string; file?: boolean; mime?: string } = {}) {
    const req = request(app.getHttpServer()).post("/handoff/job-card");
    if (opts.key !== null) req.set("x-handoff-key", opts.key ?? KEY);
    req.field("card", opts.cardJson ?? JSON.stringify(card));
    if (opts.file !== false) {
      req.attach("file", PNG, { filename: "c.png", contentType: opts.mime ?? "image/png" });
    }
    return req;
  }

  beforeAll(async () => {
    process.env.HANDOFF_KEY = KEY;
    delete process.env.HANDOFF_ACCOUNT_ID;
    app = await makeApp();
  });

  beforeEach(async () => {
    await resetTables();
    accountId = (await newAccount(app)).id;
  });

  afterAll(async () => {
    await app.close();
    delete process.env.HANDOFF_KEY;
  });

  it("rejects a missing key with 401", async () => {
    await send({ key: null }).expect(401);
  });

  it("rejects a wrong key with 401", async () => {
    await send({ key: "nope" }).expect(401);
  });

  it("rejects a card that does not validate with 400", async () => {
    await send({ cardJson: JSON.stringify({ ...card, applyUrl: "not a url" }) }).expect(400);
    await send({ cardJson: "{not json" }).expect(400);
    await send({ cardJson: JSON.stringify({ ...card, role: "" }) }).expect(400);
  });

  it("rejects a missing file and a non PNG/JPEG file with 400", async () => {
    await send({ file: false }).expect(400);
    await send({ mime: "video/mp4" }).expect(400);
    await send({ mime: "image/webp" }).expect(400);
  });

  it("answers 409 when there is no active account", async () => {
    await app.get(AccountRepository).update(accountId, { status: "DISABLED" });
    const res = await send().expect(409);
    expect(res.body.message).toMatch(/no active account/i);
  });

  it("answers 409 when several accounts are active and none is named", async () => {
    await newAccount(app, "Second Co", "99");
    const res = await send().expect(409);
    expect(res.body.message).toMatch(/several active accounts/i);
  });

  it("creates a pending post with the template caption and records applyUrl and source", async () => {
    const res = await send().expect(201);
    expect(res.body).toMatchObject({
      accountId,
      status: "PENDING_APPROVAL",
      caption: EXPECTED_CAPTION,
      created: true,
    });

    const post = await app.get(PostRepository).get(accountId, res.body.postId);
    expect(post).toMatchObject({
      status: "PENDING_APPROVAL",
      format: "IMAGE",
      caption: EXPECTED_CAPTION,
      hashtags: ["#hiring", "#jobs"],
      applyUrl: card.applyUrl,
      source: { app: "iolar-studio", ref: "card-1" },
    });
    expect(new Date(post!.scheduledAt).getTime()).toBeGreaterThan(Date.now());
    const asset = await app.get(MediaAssetRepository).get(accountId, post!.mediaAssetIds[0]!);
    expect(asset?.contentType).toBe("image/png");
  });

  it("shows the post in GET /approvals", async () => {
    await app.get(UserRepository).create("op@example.com", await app.get(PasswordService).hash("pw"));
    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "op@example.com", password: "pw" });
    const cookie = login.headers["set-cookie"]!;

    const created = await send().expect(201);
    const list = await request(app.getHttpServer())
      .get(`/approvals?accountId=${accountId}`)
      .set("Cookie", cookie)
      .expect(200);
    expect(list.body.map((p: { id: string }) => p.id)).toEqual([created.body.postId]);
  });

  it("uses the account's linkKeyword in the caption", async () => {
    await app.get(AccountRepository).update(accountId, { linkKeyword: "APPLY" });
    const res = await send().expect(201);
    expect(res.body.caption).toContain("Comment APPLY and we'll DM you the link.");
  });

  it("returns 200 with the same post for a repeated cardId", async () => {
    const first = await send().expect(201);
    const second = await send().expect(200);
    expect(second.body.postId).toBe(first.body.postId);
    expect(second.body.created).toBe(false);

    const pending = await app.get(PostRepository).listByStatus(accountId, "PENDING_APPROVAL");
    expect(pending).toHaveLength(1);
  });

  it("honours an explicit accountId even when several are active", async () => {
    await newAccount(app, "Second Co", "99");
    const res = await send({ cardJson: JSON.stringify({ ...card, accountId }) }).expect(201);
    expect(res.body.accountId).toBe(accountId);
  });

  it("answers 409 for an explicit accountId that does not exist", async () => {
    await send({ cardJson: JSON.stringify({ ...card, accountId: "nope" }) }).expect(409);
  });

  it("falls back to HANDOFF_ACCOUNT_ID when several are active", async () => {
    await newAccount(app, "Second Co", "99");
    const handoff = app.get(AppConfigService).handoff;
    handoff.accountId = accountId;
    try {
      const res = await send().expect(201);
      expect(res.body.accountId).toBe(accountId);
    } finally {
      handoff.accountId = undefined;
    }
  });
});
