// Supabase settings from .env.local. Accepts the newer "publishable" key name
// and the older "anon" key name, since Supabase's docs show both.
export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const hasSupabaseEnv = Boolean(supabaseUrl && supabaseKey);
