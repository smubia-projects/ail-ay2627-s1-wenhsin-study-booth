import { NextResponse, type NextRequest } from "next/server";
import { getCaller, isUuid } from "@/lib/apiAuth";

// Closes a study session when the tab is closed (called with navigator.sendBeacon).
export async function POST(request: NextRequest) {
  let body: { sessionId?: unknown } = {};
  try {
    body = JSON.parse(await request.text());
  } catch {}
  const { supabase, user } = await getCaller();
  if (!user || !isUuid(body.sessionId)) return NextResponse.json({ ok: false }, { status: 400 });
  // RLS limits the update to the caller's own session.
  await supabase
    .from("study_sessions")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", body.sessionId)
    .is("ended_at", null);
  return NextResponse.json({ ok: true });
}
