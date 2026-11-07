import { NextResponse, type NextRequest } from "next/server";
import { aiConfig, aiConfigured, aiMode, fullAiError, missingAiConfig } from "@/lib/ai";
import { suggestCaptions } from "@/lib/captions";
import { decideCheckin } from "@/lib/checkin";
import { moderatePost } from "@/lib/moderation";
import { writeStory } from "@/lib/story";

export const maxDuration = 60;

// POST { image } with header x-redteam-token -> one test call per AI feature,
// using exactly the code the real routes use, with full error details.
// Run it with `npm run ai:check`.
export async function POST(request: NextRequest) {
  const token = process.env.REDTEAM_TOKEN;
  if (!token || request.headers.get("x-redteam-token") !== token) {
    return NextResponse.json({ error: "Set REDTEAM_TOKEN on the server and send it as x-redteam-token." }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { image?: unknown };
  const image = typeof body.image === "string" ? body.image : undefined;

  const cfg = aiConfig();
  const config = {
    model: cfg.model || "(missing ANTHROPIC_MODEL)",
    baseURL: cfg.baseURL ?? "(default Anthropic API)",
    apiKey: cfg.apiKey ? `set (${cfg.apiKey.length} chars)` : "(missing ANTHROPIC_API_KEY)",
    fallbackModels: cfg.fallbackModels.length ? cfg.fallbackModels : "off (ANTHROPIC_FALLBACK_MODELS is empty)",
  };
  if (!aiConfigured()) return NextResponse.json({ config, error: `Missing ${missingAiConfig()}` }, { status: 500 });

  const run = async (name: string, fn: () => Promise<unknown>) => {
    const t0 = Date.now();
    try {
      const result = await fn();
      return { route: name, ok: true, ms: Date.now() - t0, result };
    } catch (e) {
      return { route: name, ok: false, ms: Date.now() - t0, error: fullAiError(e) };
    }
  };

  const results = [
    await run("/api/moderate", () => moderatePost({ imageBase64: image, typedText: "good luck on chem tonight!", timeoutMs: 30_000 })),
    image
      ? await run("/api/caption", () =>
          suggestCaptions({ imageBase64: image, minutesStudied: 75, localTime: "Tuesday 9:40 PM", recentCaptions: [], timeoutMs: 30_000 }),
        )
      : { route: "/api/caption", ok: false, ms: 0, error: { reason: "no test image sent" } },
    await run("/api/checkin", () =>
      decideCheckin(
        {
          localTime: "Tuesday 9:40 PM",
          pastMidnight: false,
          onlineCount: 2,
          members: [
            { name: "Mina", online: true, minutesStudiedToday: 130, currentSessionMinutes: 125, quietFor90Min: false },
            { name: "Jo", online: true, minutesStudiedToday: 140, currentSessionMinutes: 130, quietFor90Min: true },
          ],
          recentCheckins: [],
          demoForced: true,
        },
        true,
        30_000,
      ),
    ),
    await run("/api/weekly-story", () =>
      writeStory(
        { members: 3, active_members: 3, total_hours: 21.5, study_sessions: 14, longest_session_minutes: 140, late_night_sessions: 2, days_studied: 6, longest_streak_days: 5, posts: 23, fog_posts: 9, photo_posts: 10, notes: 4 },
        45_000,
      ),
    ),
  ];
  return NextResponse.json({ config, mode: aiMode(), results });
}
