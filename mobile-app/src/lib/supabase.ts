import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import { mobileEnv } from "../config/env";

export const supabase = createClient(mobileEnv.supabaseUrl, mobileEnv.supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
