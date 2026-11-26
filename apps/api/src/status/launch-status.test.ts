import { describe, expect, it } from "vitest";
import { isPublicHttpsUrl, launchStatus } from "./launch-status";

describe("isPublicHttpsUrl", () => {
  it("accepts a public https host", () => {
    expect(isPublicHttpsUrl("https://media.example.com")).toBe(true);
    expect(isPublicHttpsUrl("https://media.example.com:8443/bucket")).toBe(true);
  });

  it("rejects http, loopback, private ranges and bare hostnames", () => {
    for (const url of [
      "http://media.example.com",
      "https://localhost:9200",
      "https://127.0.0.1:9200",
      "https://10.0.0.5",
      "https://192.168.1.20",
      "https://172.16.0.1",
      "https://172.31.255.1",
      "https://169.254.1.1",
      "https://minio",
      "https://nas.local",
      "https://[::1]:9200",
      "not a url",
    ]) {
      expect(isPublicHttpsUrl(url), url).toBe(false);
    }
    expect(isPublicHttpsUrl("https://172.32.0.1")).toBe(true);
  });
});

describe("launchStatus", () => {
  const base = {
    instagramMode: "fake" as const,
    instagramGraphVersion: undefined,
    defaultTimezone: "Asia/Kolkata",
    s3: { endpoint: "http://localhost:9200" },
    meta: {},
  };

  it("reports fake mode with a local media endpoint and no webhook", () => {
    expect(launchStatus(base)).toEqual({
      mode: "fake",
      graphVersion: null,
      defaultTimezone: "Asia/Kolkata",
      mediaUrlPublic: false,
      mediaHost: "localhost:9200",
      webhookConfigured: false,
    });
  });

  it("reports live mode, a public media endpoint and a configured webhook, without secrets", () => {
    const out = launchStatus({
      instagramMode: "live",
      instagramGraphVersion: "v21.0",
      defaultTimezone: "Asia/Kolkata",
      s3: { endpoint: "https://media.example.com" },
      meta: { appSecret: "SECRET", webhookVerifyToken: "VERIFY" },
    });
    expect(out).toMatchObject({
      mode: "live",
      graphVersion: "v21.0",
      mediaUrlPublic: true,
      webhookConfigured: true,
    });
    expect(JSON.stringify(out)).not.toMatch(/SECRET|VERIFY/);
  });

  it("needs both the app secret and the verify token for the webhook", () => {
    expect(launchStatus({ ...base, meta: { appSecret: "s" } }).webhookConfigured).toBe(false);
    expect(launchStatus({ ...base, meta: { webhookVerifyToken: "v" } }).webhookConfigured).toBe(false);
  });
});
