import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PasswordService } from "../src/auth/password.service";
import { UserRepository } from "../src/auth/user.repository";
import { resetTables } from "./dynamo-fixture";

describe("auth", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  beforeEach(async () => {
    await resetTables();
    const users = app.get(UserRepository);
    const passwords = app.get(PasswordService);
    await users.create("operator@example.com", await passwords.hash("s3cret"));
  });

  afterAll(async () => {
    await app.close();
  });

  it("logs in and sets an httpOnly session cookie", async () => {
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "operator@example.com", password: "s3cret" })
      .expect(200);

    const cookie = res.headers["set-cookie"]?.[0] ?? "";
    expect(cookie).toContain("intabot_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
  });

  it("rejects a wrong password with 401 and no cookie", async () => {
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "operator@example.com", password: "wrong" })
      .expect(401);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("rejects an unknown email with 401", async () => {
    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "nobody@example.com", password: "s3cret" })
      .expect(401);
  });

  it("returns 401 from /auth/me without a session", async () => {
    await request(app.getHttpServer()).get("/auth/me").expect(401);
  });

  it("returns the email from /auth/me with a valid session", async () => {
    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "operator@example.com", password: "s3cret" });
    const cookie = login.headers["set-cookie"]!;

    const me = await request(app.getHttpServer()).get("/auth/me").set("Cookie", cookie).expect(200);
    expect(me.body).toEqual({ email: "operator@example.com" });
  });

  it("invalidates the session on logout", async () => {
    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "operator@example.com", password: "s3cret" });
    const cookie = login.headers["set-cookie"]!;

    await request(app.getHttpServer()).post("/auth/logout").set("Cookie", cookie).expect(200);
    await request(app.getHttpServer()).get("/auth/me").set("Cookie", cookie).expect(401);
  });

  it("never returns the password hash", async () => {
    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "operator@example.com", password: "s3cret" });
    expect(JSON.stringify(login.body)).not.toContain("argon2");
  });
});
