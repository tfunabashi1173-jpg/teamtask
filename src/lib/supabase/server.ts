import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let supabaseAdminClient: SupabaseClient | null = null;
const DEFAULT_DB_SCHEMA = process.env.SUPABASE_DB_SCHEMA || "teamtask";

function getEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }
  return value;
}

function getSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
}

export function createSupabaseAdminClient() {
  if (!supabaseAdminClient) {
    const supabaseUrl = getSupabaseUrl();
    if (!supabaseUrl) {
      throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured.");
    }

    supabaseAdminClient = createClient(supabaseUrl, getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      db: {
        schema: DEFAULT_DB_SCHEMA,
      },
    });
  }

  return supabaseAdminClient;
}
