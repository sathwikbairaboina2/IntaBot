import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PasswordService } from "../src/auth/password.service";
import { UserRepository } from "../src/auth/user.repository";
import { resetTables } from "./dynamo-fixture";

describe("accounts", () => {
  let app: INestApplication;
  let cookie: string[];

  const body = {
    name: "Studio Nord",
    igUserId: "17841400000000000",
    username: "studionord",
    accessToken: "IGQVJ-plaintext-token",
    tokenExpiresAt: "2026-10-13T00:00:00.000Z",
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  beforeEach(async () => {
    await resetTables();
    await app
      .get(UserRepository)
      .create("operator@example.com", await app.get(PasswordService).hash("s3cret"));
    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "operator@example.com", password: "s3cret" });
    cookie = login.headers["set-cookie"]!;
  });

  afterAll(async () => {
    await app.close();
  });

  it("requires authentication", async () => {
    await request(app.getHttpServer()).get("/accounts").expect(401);
  });

  it("creates an account", async () => {
    const res = await request(app.getHttpServer())
      .post("/accounts")
      .set("Cookie", cookie)
      .send(body)
      .expect(201);
    expect(res.body.username).toBe("studionord");
    expect(res.body.status).toBe("ACTIVE");
  });

  it("never returns the token, encrypted or plaintext", async () => {
    const res = await request(app.getHttpServer())
      .post("/accounts")
      .set("Cookie", cookie)
      .send(body)
      .expect(201);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain("IGQVJ-plaintext-token");
    expect(serialized).not.toContain("accessTokenEncrypted");
  });

  it("lists created accounts", async () => {
    await request(app.getHttpServer())
      .post("/accounts")
      .set("Cookie", cookie)
      .send(body)
      .expect(201);
    const res = await request(app.getHttpServer())
      .get("/accounts")
      .set("Cookie", cookie)
      .expect(200);
    expect(res.body).toHaveLength(1);
  });

  it("returns 404 for an unknown account", async () => {
    await request(app.getHttpServer()).get("/accounts/nope").set("Cookie", cookie).expect(404);
  });

  it("rejects an invalid body with 400", async () => {
    await request(app.getHttpServer())
      .post("/accounts")
      .set("Cookie", cookie)
      .send({ ...body, tokenExpiresAt: "soon" })
      .expect(400);
  });

  it("toggles dryRun via PATCH", async () => {
    const created = await request(app.getHttpServer())
      .post("/accounts")
      .set("Cookie", cookie)
      .send(body)
      .expect(201);
    const patched = await request(app.getHttpServer())
      .patch(`/accounts/${created.body.id}`)
      .set("Cookie", cookie)
      .send({ dryRun: false })
      .expect(200);
    expect(patched.body.dryRun).toBe(false);
  });
});
