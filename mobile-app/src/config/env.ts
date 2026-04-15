function getOptionalEnv(name: string) {
  const value = process.env[name];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function getRequiredEnv(name: string) {
  const value = getOptionalEnv(name);
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }

  return value;
}

export const mobileEnv = {
  supabaseUrl: getRequiredEnv("EXPO_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: getRequiredEnv("EXPO_PUBLIC_SUPABASE_ANON_KEY"),
  webAppUrl: getRequiredEnv("EXPO_PUBLIC_WEB_APP_URL"),
};

export function formatHostLabel(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
