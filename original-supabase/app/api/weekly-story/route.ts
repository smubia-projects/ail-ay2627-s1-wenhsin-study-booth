import { NextResponse, type NextRequest } from "next/server";
import { getCaller, isMember, isUuid } from "@/lib/apiAuth";
import { aiConfigured, fullAiError, missingAiConfig } from "@/lib/ai";
import { writeStory } from "@/lib/story";
import { createAdminClient, hasAdminEnv } from "@/utils/supabase/admin";

export const maxDuration = 45;

// POST { groupId, tz } -> { title, story, stats }. Stats come from SQL; the AI only writes prose.
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { groupId?: unknown; tz?: unknown };
  const { supabase, user } = await getCaller();
  if (!user || !isUuid(body.groupId) || !(await isMember(supabase, body.groupId))) {
    return NextResponse.json({ error: "Not a member of this group." }, { status: 401 });
  }
  if (!hasAdminEnv) return NextResponse.json({ error: "Missing SUPABASE_SERVICE_ROLE_KEY." }, { status: 500 });

  const tz = typeof body.tz === "string" && /^[A-Za-z_]+(\/[A-Za-z_+-]+)*$/.test(body.tz) ? body.tz : "UTC";
  const admin = createAdminClient();
  const { data: stats, error } = await admin.rpc("group_week_stats", { gid: body.groupId, tz });
  if (error || !stats) return NextResponse.json({ error: "Couldn't compute this week's stats." }, { status: 500 });

  if (!aiConfigured()) return NextResponse.json({ error: `Missing ${missingAiConfig()}.`, stats }, { status: 500 });
  try {
    const result = await writeStory(stats, 30_000);
    await admin.from("weekly_stories").insert({ group_id: body.groupId, story: `${result.title}\n\n${result.story}`, stats });
    return NextResponse.json({ ...result, stats });
  } catch (e) {
    console.warn("weekly story failed", JSON.stringify(fullAiError(e)));
    return NextResponse.json({ error: "The story writer is taking a nap. Try again in a minute.", stats }, { status: 503 });
  }
}
