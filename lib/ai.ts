// Server-only helper for AI calls (used by the API in server/). Every call returns JSON validated with zod;
// anything else (timeout, refusal, bad JSON) throws, and callers decide how to fail.
//
// Any OpenAI-compatible chat-completions gateway (AI Lodge uses apiyi). Configuration comes only from env:
//   API_KEY             required
//   API_BASE_URL        optional, default https://api.apiyi.com/v1
//   MODEL_NAME          text model (weekly story), default deepseek-v4-1-flash-260910 (JSON mode + zod)
//   VISION_MODEL_NAME   vision model (moderation, captions), default deepseek-v4-1-flash-260910 (v4.1 reads images)
// The original called Anthropic's Messages API (ANTHROPIC_* env vars); those names are read as fallbacks.
// The original Anthropic version is kept in original-supabase/lib/ai.ts.
import { z } from "zod";

export type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

const DEFAULT_MODEL = "deepseek-v4-1-flash-260910";
const DEFAULT_VISION_MODEL = "deepseek-v4-1-flash-260910";

export function aiConfig() {
  const model = process.env.MODEL_NAME?.trim() || process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
  return {
    apiKey: process.env.API_KEY?.trim() || process.env.ANTHROPIC_API_KEY?.trim() || "",
    baseURL: (process.env.API_BASE_URL?.trim() || "https://api.apiyi.com/v1").replace(/\/+$/, ""),
    model,
    visionModel: process.env.VISION_MODEL_NAME?.trim() || DEFAULT_VISION_MODEL,
  };
}

export function aiConfigured() {
  return Boolean(aiConfig().apiKey);
}

export function missingAiConfig() {
  return aiConfig().apiKey ? "" : "API_KEY";
}

/** An AI failure with everything needed to debug it. */
export class AiError extends Error {
  constructor(
    message: string,
    readonly detail: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AiError";
  }
}

export async function askJson<T extends z.ZodType>(opts: {
  system: string;
  content: ContentPart[];
  schema: T;
  timeoutMs: number;
  /** "vision" for image inputs (VISION_MODEL_NAME), else the text model. */
  purpose?: "text" | "vision";
  maxTokens?: number;
}): Promise<z.infer<T>> {
  const cfg = aiConfig();
  if (!cfg.apiKey) throw new AiError(`Missing ${missingAiConfig()}`, { config: "missing" });
  const model = opts.purpose === "vision" ? cfg.visionModel : cfg.model;
  const jsonSchema = JSON.stringify(z.toJSONSchema(opts.schema));
  let res: Response;
  try {
    res = await fetch(`${cfg.baseURL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model,
        max_tokens: opts.maxTokens ?? 2000,
        response_format: { type: "json_object" },
        // DeepSeek thinks first by default; every call here has a timeout (captions 8 s), so thinking is off.
        ...(/deepseek/i.test(model) ? { reasoning_effort: "none" } : {}),
        messages: [
          {
            role: "system",
            content: `${opts.system}\n\nRespond with ONLY a JSON object (no prose, no code fences) matching this JSON Schema:\n${jsonSchema}`,
          },
          { role: "user", content: opts.content },
        ],
      }),
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch (e) {
    throw wrap(e);
  }
  const body = (await res.json().catch(() => null)) as {
    choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
    error?: { message?: string };
  } | null;
  if (!res.ok) {
    throw new AiError(describeStatus(res.status, model, body?.error?.message), { status: res.status, error: body?.error });
  }
  const choice = body?.choices?.[0];
  if (choice?.message?.refusal) throw new AiError("model refused", { finish_reason: choice.finish_reason });
  if (choice?.finish_reason === "length") throw new AiError("output truncated", { finish_reason: "length" });
  const text = choice?.message?.content ?? "";
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new AiError("the AI's answer had no JSON", { text: text.slice(0, 500) });
  try {
    return opts.schema.parse(JSON.parse(text.slice(start, end + 1)));
  } catch (e) {
    throw wrap(e);
  }
}

function describeStatus(status: number, model: string, message = "") {
  if (status === 401) return "the AI key (API_KEY) was rejected";
  if (status === 403) return `this AI key isn't allowed to use "${model}"`;
  if (status === 404) return `"${model}" wasn't found at this AI provider (check the model name and API_BASE_URL)`;
  if (status === 429) return `the AI provider returned 429: ${message.slice(0, 200)}`;
  if (status === 400) return `the AI request was rejected: ${message.slice(0, 200)}`;
  return `AI service error ${status}: ${message.slice(0, 200)}`.trim();
}

function errorDetail(e: unknown): Record<string, unknown> {
  if (e instanceof AiError) return e.detail;
  if (e instanceof z.ZodError) return { zod: e.issues };
  if (e instanceof Error) return { name: e.name, message: e.message };
  return { error: String(e) };
}

function wrap(e: unknown) {
  if (e instanceof AiError) return e;
  return new AiError(describeAiError(e), errorDetail(e));
}

/** Image content part from a data URL or raw base64 JPEG/PNG. */
export function imageBlock(data: string, mediaType: "image/jpeg" | "image/png" = "image/jpeg"): ContentPart {
  const url = /^data:image\/(?:jpeg|png);base64,/.test(data) ? data : `data:${mediaType};base64,${data}`;
  return { type: "image_url", image_url: { url } };
}

/** Wraps user-provided text so the model treats it as data, never as instructions. */
export function asData(tag: string, text: string) {
  // Strip anything that could close our tag early.
  const clean = text.replace(new RegExp(`</?${tag}>`, "gi"), "");
  return `<${tag}>\n${clean}\n</${tag}>`;
}

/** Short, human-readable reason for an AI failure (shown to the sender and logged). */
export function describeAiError(e: unknown): string {
  if (e instanceof AiError) return e.message;
  if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) return "the AI took too long";
  if (e instanceof TypeError) return "couldn't reach the AI service (check API_BASE_URL)";
  if (e instanceof z.ZodError) return "the AI's answer wasn't in the expected format";
  if (e instanceof SyntaxError) return "the AI's answer wasn't valid JSON";
  if (e instanceof Error) return e.message.slice(0, 200);
  return "unknown error";
}

/** Full error details for logs. */
export function fullAiError(e: unknown) {
  return { reason: describeAiError(e), ...errorDetail(e) };
}
