import { createClient } from "@supabase/supabase-js";

let supabaseBrowserClient: any | null = null;

export function createSupabaseBrowserClient(): any {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  if (!supabaseBrowserClient) {
    supabaseBrowserClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
      db: {
        schema: "public",
      },
    });
  }

  return supabaseBrowserClient;
}
