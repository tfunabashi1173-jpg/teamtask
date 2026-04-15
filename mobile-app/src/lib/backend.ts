import { mobileEnv } from "../config/env";

export type BackendVersion = {
  ok: boolean;
  appVersion: string;
  commitSha: string;
};

export async function fetchBackendVersion() {
  const response = await fetch(`${mobileEnv.webAppUrl}/api/version`, {
    headers: {
      "Cache-Control": "no-store",
    },
  });

  if (!response.ok) {
    throw new Error("Failed to load backend version.");
  }

  return (await response.json()) as BackendVersion;
}
