/**
 * Thin Ollama chat client for the three model roles.
 *
 * Ollama has no equivalent of Anthropic's `stop_reason: "refusal"`, so the
 * only failure signal a local model gives us is malformed output. The design
 * calls for one retry on a structured-output validation failure and then a
 * human, so the retry lives here and the adapters map OllamaSchemaError onto
 * their own refusal type.
 */
export class OllamaSchemaError extends Error {
  constructor(readonly detail: string) {
    super(`ollama returned unparseable output: ${detail}`);
  }
}

export interface OllamaChatArgs<T = unknown> {
  model: string;
  prompt: string;
  /** JSON Schema handed to Ollama's `format` field. */
  schema: Record<string, unknown>;
  system?: string;
  /** Retries on a parse failure only. Transport errors propagate immediately. */
  retries?: number;
  numCtx?: number;
  temperature?: number;
  /**
   * Shape check on the parsed value. A local model honours `format` loosely,
   * so a syntactically valid but wrong-shaped object is the common failure —
   * it has to trigger the same retry as unparseable text.
   */
  validate?: (value: unknown) => T;
}

interface OllamaChatResponse {
  message?: { content?: string };
  error?: string;
}

export const DEFAULT_NUM_CTX = 8192;

export class OllamaClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async chatJson<T = unknown>(args: OllamaChatArgs<T>): Promise<T> {
    const attempts = (args.retries ?? 1) + 1;
    let last = "";

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const content = await this.callOnce(args);
      try {
        const parsed: unknown = JSON.parse(content);
        return args.validate ? args.validate(parsed) : (parsed as T);
      } catch {
        // Keep the head only: a runaway generation must not end up in a log.
        last = content.slice(0, 200);
      }
    }
    throw new OllamaSchemaError(last);
  }

  private async callOnce(args: OllamaChatArgs): Promise<string> {
    const messages: Array<{ role: string; content: string }> = [];
    if (args.system) messages.push({ role: "system", content: args.system });
    messages.push({ role: "user", content: args.prompt });

    const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: args.model,
        stream: false,
        // Qwen3.x emits reasoning tokens by default; they would land in the
        // content block and break JSON parsing.
        think: false,
        format: args.schema,
        messages,
        options: {
          temperature: args.temperature ?? 0.4,
          num_ctx: args.numCtx ?? DEFAULT_NUM_CTX,
        },
      }),
    });

    if (!res.ok) {
      throw new Error(`ollama request failed with ${res.status}`);
    }

    const body = (await res.json()) as OllamaChatResponse;
    if (body.error) throw new Error(`ollama error: ${body.error}`);

    const content = body.message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      throw new OllamaSchemaError("empty content");
    }
    return content;
  }
}
