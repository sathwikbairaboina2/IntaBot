import { describe, expect, it, vi } from "vitest";
import { OllamaClient, OllamaSchemaError } from "./ollama.client";

const schema = { type: "object", properties: { a: { type: "string" } }, required: ["a"] };

function respond(content: string) {
  return { ok: true, status: 200, json: async () => ({ message: { content } }) } as Response;
}

describe("OllamaClient", () => {
  it("posts to /api/chat with the schema, streaming and thinking disabled", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respond('{"a":"ok"}'));
    const out = await new OllamaClient("http://localhost:11437/", fetchImpl as never).chatJson({
      model: "qwen3.6:27b",
      prompt: "hello",
      schema,
    });

    expect(out).toEqual({ a: "ok" });
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("http://localhost:11437/api/chat");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe("qwen3.6:27b");
    expect(body.format).toEqual(schema);
    expect(body.stream).toBe(false);
    expect(body.think).toBe(false);
  });

  it("sends the system prompt ahead of the user prompt when given one", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respond('{"a":"ok"}'));
    await new OllamaClient("http://x", fetchImpl as never).chatJson({
      model: "m",
      prompt: "user text",
      system: "brand voice",
      schema,
    });
    const body = JSON.parse((fetchImpl.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.messages).toEqual([
      { role: "system", content: "brand voice" },
      { role: "user", content: "user text" },
    ]);
  });

  it("retries once on unparseable output, then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(respond("not json at all"))
      .mockResolvedValueOnce(respond('{"a":"second try"}'));

    const out = await new OllamaClient("http://x", fetchImpl as never).chatJson({
      model: "m",
      prompt: "p",
      schema,
    });
    expect(out).toEqual({ a: "second try" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws OllamaSchemaError after the retry is also unparseable", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respond("still not json"));
    const client = new OllamaClient("http://x", fetchImpl as never);
    await expect(client.chatJson({ model: "m", prompt: "p", schema })).rejects.toBeInstanceOf(
      OllamaSchemaError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not put the whole generation in the error message", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respond("x".repeat(5000)));
    const client = new OllamaClient("http://x", fetchImpl as never);
    const err = await client.chatJson({ model: "m", prompt: "p", schema }).catch((e) => e);
    expect(err).toBeInstanceOf(OllamaSchemaError);
    expect((err as Error).message.length).toBeLessThan(300);
  });

  it("retries when the shape is wrong even though the JSON parses", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(respond('{"wrong":"field"}'))
      .mockResolvedValueOnce(respond('{"a":"right"}'));

    const validate = (v: unknown) => {
      const o = v as { a?: string };
      if (typeof o.a !== "string") throw new Error("missing a");
      return o as { a: string };
    };

    const out = await new OllamaClient("http://x", fetchImpl as never).chatJson({
      model: "m",
      prompt: "p",
      schema,
      validate,
    });
    expect(out).toEqual({ a: "right" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("propagates a transport failure without retrying", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503 } as Response);
    const client = new OllamaClient("http://x", fetchImpl as never);
    await expect(client.chatJson({ model: "m", prompt: "p", schema })).rejects.toThrow(/503/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("surfaces an error field returned with HTTP 200", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ error: "model 'nope' not found" }),
    } as Response);
    await expect(
      new OllamaClient("http://x", fetchImpl as never).chatJson({ model: "nope", prompt: "p", schema }),
    ).rejects.toThrow(/not found/);
  });
});
