// Browser client for the Study Booth API (Cloud Run, see server/). NEXT_PUBLIC_API_BASE is set on Vercel.
import { showDemoPaused, showRateLimitCTA } from "@/lib/cta";

const API = (process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8080").replace(/\/+$/, "");

/** The AI Lodge limit (429) or the demo being paused (503). The AI step stops; the card explains why. */
export class LimitError extends Error {}

export async function api<T>(path: string, body: unknown, timeoutMs = 30_000): Promise<T> {
  const res = await fetch(API + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string; queries_used?: number };
  if (res.status === 429) {
    showRateLimitCTA(data.queries_used ?? "a few");
    throw new LimitError("You've reached this demo's AI limit for now.");
  }
  if (res.status === 503) {
    showDemoPaused(data.message);
    throw new LimitError("The demo is paused right now.");
  }
  if (!res.ok) throw Object.assign(new Error(data.error || data.message || "Something went wrong."), { data });
  return data;
}
