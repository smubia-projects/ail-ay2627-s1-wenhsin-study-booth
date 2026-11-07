import { NextResponse, type NextRequest } from "next/server";
import { getCaller, isMember, isUuid } from "@/lib/apiAuth";
import { aiConfigured, fullAiError } from "@/lib/ai";
import { decideCheckin } from "@/lib/checkin";
import { createAdminClient, hasAdminEnv } from "@/utils/supabase/admin";

export const maxDuration = 20;

const TIMEOUT_MS = 8000;
const ONLINE_WINDOW_MS = 12 * 60_000; // heartbeat every 5 min, so 12 min = still here
const QUIET_MS = 90 * 60_000;

// POST { groupId, localTime?, localHour?, force? } -> { shouldNudge, message? }
// Called by every open client every 5 minutes; the DB rate limit makes sure at
// most one evaluation runs every 4 minutes and one check-in posts per 45 minutes.
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    groupId?: unknown;
    localTime?: unknown;
    localHour?: unknown;
    force?: unknown;
  };
  const { supabase, user } = await getCaller();
  if (!user || !isUuid(body.groupId) || !(await isMember(supabase, body.groupId))) {
    return NextResponse.json({ shouldNudge: false }, { status: 401 });
  }
  if (!hasAdminEnv || !aiConfigured()) return NextResponse.json({ shouldNudge: false, reason: "not configured" });

  const admin = createAdminClient();
  const force = body.force === true;
  const { data: claimed } = await admin.rpc("claim_checkin_slot", { gid: body.groupId, force });
  if (!claimed) return NextResponse.json({ shouldNudge: false, reason: "rate limited" });

  // Group state, computed in code.
  const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const [{ data: memberRows }, { data: sessions }, { data: posts }, { data: lastCheckins }] = await Promise.all([
    admin.from("group_members").select("user_id").eq("group_id", body.groupId),
    admin.from("study_sessions").select("user_id, started_at, ended_at, last_seen_at").eq("group_id", body.groupId).gte("started_at", since),
    admin.from("posts").select("user_id, created_at").eq("group_id", body.groupId).eq("status", "approved").gte("created_at", since),
    admin.from("checkins").select("message, created_at").eq("group_id", body.groupId).order("created_at", { ascending: false }).limit(3),
  ]);
  const ids = (memberRows ?? []).map((m) => m.user_id as string);
  const { data: profiles } = await admin.from("profiles").select("id, display_name").in("id", ids);
  const now = Date.now();
  const members = ids.map((id) => {
    const mine = (sessions ?? []).filter((s) => s.user_id === id);
    const minutes = mine.reduce((sum, s) => {
      const end = s.ended_at ? new Date(s.ended_at).getTime() : Math.min(now, new Date(s.last_seen_at).getTime() + 5 * 60_000);
      return sum + Math.max(0, end - new Date(s.started_at).getTime()) / 60_000;
    }, 0);
    const open = mine.find((s) => !s.ended_at && now - new Date(s.last_seen_at).getTime() < ONLINE_WINDOW_MS);
    const lastActivity = Math.max(
      ...(posts ?? []).filter((p) => p.user_id === id).map((p) => new Date(p.created_at).getTime()),
      open ? new Date(open.started_at).getTime() : 0,
    );
    return {
      name: (profiles ?? []).find((p) => p.id === id)?.display_name ?? "friend",
      online: Boolean(open),
      minutesStudiedToday: Math.round(minutes),
      currentSessionMinutes: open ? Math.round((now - new Date(open.started_at).getTime()) / 60_000) : 0,
      quietFor90Min: Boolean(open) && now - lastActivity >= QUIET_MS,
    };
  });
  const localHour = typeof body.localHour === "number" ? body.localHour : new Date().getUTCHours();
  const state = {
    localTime: typeof body.localTime === "string" ? body.localTime.slice(0, 40) : undefined,
    pastMidnight: localHour >= 0 && localHour < 5,
    onlineCount: members.filter((m) => m.online).length,
    members,
    recentCheckins: (lastCheckins ?? []).map((c) => ({ message: c.message, minutesAgo: Math.round((now - new Date(c.created_at).getTime()) / 60_000) })),
    demoForced: force,
  };

  try {
    const decision = await decideCheckin(state, force, TIMEOUT_MS);
    if (!decision.shouldNudge || !decision.message?.trim()) return NextResponse.json({ shouldNudge: false });
    const message = decision.message.trim().slice(0, 140);
    await admin.from("checkins").insert({ group_id: body.groupId, message });
    await admin.from("groups").update({ last_checkin_at: new Date().toISOString() }).eq("id", body.groupId);
    return NextResponse.json({ shouldNudge: true, message });
  } catch (e) {
    console.warn("check-in skipped", JSON.stringify(fullAiError(e)));
    return NextResponse.json({ shouldNudge: false });
  }
}
