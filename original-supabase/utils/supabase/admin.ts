// Server-only Supabase client with the service role (secret) key. Bypasses RLS,
// so only API routes use it, and only after checking who is calling.
import { createClient } from "@supabase/supabase-js";
import { supabaseUrl } from "@/utils/supabase/env";

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;

export const hasAdminEnv = Boolean(supabaseUrl && serviceKey);

export function createAdminClient() {
  if (!supabaseUrl || !serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
