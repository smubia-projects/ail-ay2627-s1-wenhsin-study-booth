import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { supabaseKey, supabaseUrl } from "@/utils/supabase/env";

// Refreshes the Supabase auth session on every request so Server Components
// always see a valid session.
export const updateSession = async (request: NextRequest) => {
  let supabaseResponse = NextResponse.next({ request });

  // Without keys (missing .env.local), skip auth so non-Supabase pages still work.
  if (!supabaseUrl || !supabaseKey) return supabaseResponse;

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  // Do not remove: this call is what refreshes an expired session.
  await supabase.auth.getUser();

  return supabaseResponse;
};
