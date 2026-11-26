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
  let cookie: string;

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

  it("patches linkKeyword and shows it in the view", async () => {
    const created = await request(app.getHttpServer())
      .post("/accounts")
      .set("Cookie", cookie)
      .send(body)
      .expect(201);
    expect(created.body.linkKeyword).toBe("LINK");
    const patched = await request(app.getHttpServer())
      .patch(`/accounts/${created.body.id}`)
      .set("Cookie", cookie)
      .send({ linkKeyword: "APPLY" })
      .expect(200);
    expect(patched.body.linkKeyword).toBe("APPLY");
  });

  it("patches listKeyword and listText, rejecting a text over 1000 characters", async () => {
    const created = await request(app.getHttpServer())
      .post("/accounts")
      .set("Cookie", cookie)
      .send(body)
      .expect(201);
    expect(created.body).toMatchObject({ listKeyword: "LIST", listText: null });
    const patched = await request(app.getHttpServer())
      .patch(`/accounts/${created.body.id}`)
      .set("Cookie", cookie)
      .send({ listKeyword: "JOBS", listText: "This week: a, b, c" })
      .expect(200);
    expect(patched.body).toMatchObject({ listKeyword: "JOBS", listText: "This week: a, b, c" });
    await request(app.getHttpServer())
      .patch(`/accounts/${created.body.id}`)
      .set("Cookie", cookie)
      .send({ listText: "x".repeat(1001) })
      .expect(400);
    const cleared = await request(app.getHttpServer())
      .patch(`/accounts/${created.body.id}`)
      .set("Cookie", cookie)
      .send({ listText: null })
      .expect(200);
    expect(cleared.body.listText).toBeNull();
  });

  it("gives new accounts the default zone (Asia/Kolkata) and shows the token's days left", async () => {
    const expires = new Date(Date.now() + 40 * 86_400_000 + 3_600_000).toISOString();
    const created = await request(app.getHttpServer())
      .post("/accounts")
      .set("Cookie", cookie)
      .send({ ...body, tokenExpiresAt: expires })
      .expect(201);
    expect(created.body.timezone).toBe("Asia/Kolkata");
    expect(created.body.tokenDaysLeft).toBe(40);
    const listed = await request(app.getHttpServer()).get("/accounts").set("Cookie", cookie).expect(200);
    expect(listed.body[0]).toMatchObject({ tokenExpiresAt: expires, tokenDaysLeft: 40 });
    const one = await request(app.getHttpServer())
      .get(`/accounts/${created.body.id}`)
      .set("Cookie", cookie)
      .expect(200);
    expect(one.body.tokenDaysLeft).toBe(40);
  });

  it("patches timezone and postingWindows, validating both", async () => {
    const created = await request(app.getHttpServer())
      .post("/accounts")
      .set("Cookie", cookie)
      .send(body)
      .expect(201);
    const url = `/accounts/${created.body.id}`;
    const patched = await request(app.getHttpServer())
      .patch(url)
      .set("Cookie", cookie)
      .send({ timezone: "Europe/Berlin", postingWindows: ["18:00", "09:00"] })
      .expect(200);
    expect(patched.body).toMatchObject({ timezone: "Europe/Berlin", postingWindows: ["09:00", "18:00"] });

    for (const bad of [
      { timezone: "Mars/Olympus" },
      { postingWindows: [] },
      { postingWindows: ["09:00", "09:00"] },
      { postingWindows: ["9am"] },
      { postingWindows: ["01:00", "02:00", "03:00", "04:00", "05:00", "06:00", "07:00"] },
    ]) {
      await request(app.getHttpServer()).patch(url).set("Cookie", cookie).send(bad).expect(400);
    }
    const after = await request(app.getHttpServer()).get(url).set("Cookie", cookie).expect(200);
    expect(after.body).toMatchObject({ timezone: "Europe/Berlin", postingWindows: ["09:00", "18:00"] });
  });
});
