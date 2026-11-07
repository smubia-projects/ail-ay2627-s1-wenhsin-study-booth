// Shared checks for API routes: who is calling, and are they in this group?
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

export async function getCaller() {
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

/** True if the signed-in user can see the group (RLS only returns groups you belong to). */
export async function isMember(supabase: Awaited<ReturnType<typeof getCaller>>["supabase"], groupId: string) {
  const { data } = await supabase.from("groups").select("id").eq("id", groupId).maybeSingle();
  return Boolean(data);
}

export const isUuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
