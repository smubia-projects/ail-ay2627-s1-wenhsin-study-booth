import { createBrowserClient } from "@supabase/ssr";
import { supabaseKey, supabaseUrl } from "@/utils/supabase/env";

export const createClient = () => createBrowserClient(supabaseUrl!, supabaseKey!);
