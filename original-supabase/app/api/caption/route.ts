import { NextResponse, type NextRequest } from "next/server";
import { getCaller, isMember, isUuid } from "@/lib/apiAuth";
import { aiConfigured, fullAiError } from "@/lib/ai";
import { suggestCaptions } from "@/lib/captions";

export const maxDuration = 15;

const TIMEOUT_MS = Number(process.env.CAPTION_TIMEOUT_MS) || 5000;

// POST { image, groupId, localTime } -> { suggestions: string[] }
// Captions are optional: any failure returns an empty list and the post still sends.
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    image?: unknown;
    groupId?: unknown;
    localTime?: unknown;
    minutesStudied?: unknown;
    recentCaptions?: unknown;
  };
  if (typeof body.image !== "string" || body.image.length > 3_000_000) {
    return NextResponse.json({ suggestions: [] }, { status: 400 });
  }
  const localTime = typeof body.localTime === "string" ? body.localTime.slice(0, 40) : new Date().toUTCString();

  const redteamToken = process.env.REDTEAM_TOKEN;
  const isRedteam = Boolean(redteamToken) && request.headers.get("x-redteam-token") === redteamToken;

  let minutesStudied: number | null = null;
  let recentCaptions: string[] = [];
  if (isRedteam) {
    minutesStudied = typeof body.minutesStudied === "number" ? body.minutesStudied : null;
    recentCaptions = Array.isArray(body.recentCaptions) ? body.recentCaptions.map(String).slice(0, 3) : [];
  } else {
    const { supabase, user } = await getCaller();
    if (!user || !isUuid(body.groupId) || !(await isMember(supabase, body.groupId))) {
      return NextResponse.json({ suggestions: [] }, { status: 401 });
    }
    const [{ data: session }, { data: recent }] = await Promise.all([
      supabase
        .from("study_sessions")
        .select("started_at")
        .eq("user_id", user.id)
        .eq("group_id", body.groupId)
        .is("ended_at", null)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("posts")
        .select("caption")
        .eq("group_id", body.groupId)
        .eq("status", "approved")
        .not("caption", "is", null)
        .order("created_at", { ascending: false })
        .limit(3),
    ]);
    if (session) minutesStudied = Math.round((Date.now() - new Date(session.started_at).getTime()) / 60_000);
    recentCaptions = (recent ?? []).map((r) => r.caption as string);
  }

  if (!aiConfigured()) return NextResponse.json({ suggestions: [] });
  try {
    const suggestions = await suggestCaptions({ imageBase64: body.image, minutesStudied, localTime, recentCaptions, timeoutMs: TIMEOUT_MS });
    return NextResponse.json({ suggestions });
  } catch (e) {
    console.warn("captions unavailable", JSON.stringify(fullAiError(e)));
    return NextResponse.json({ suggestions: [] });
  }
}
