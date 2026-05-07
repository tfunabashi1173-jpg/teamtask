import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let supabaseAdminClient: SupabaseClient<any, any, any, any, any> | null = null;
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

export function getSupabaseRuntimeConfig() {
  const supabaseUrl = getSupabaseUrl();
  const dbSchema = process.env.SUPABASE_DB_SCHEMA || DEFAULT_DB_SCHEMA;
  const hasServiceRoleKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

  return {
    supabaseUrl,
    dbSchema,
    hasServiceRoleKey,
    authConfigured: Boolean(supabaseUrl && hasServiceRoleKey),
  };
}

export function createSupabaseAdminClient(): SupabaseClient<any, any, any, any, any> {
  if (!supabaseAdminClient) {
    const { supabaseUrl, dbSchema } = getSupabaseRuntimeConfig();
    if (!supabaseUrl) {
      throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured.");
    }

    supabaseAdminClient = createClient(supabaseUrl, getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      db: {
        schema: dbSchema,
      },
    });
  }

  return supabaseAdminClient;
}
