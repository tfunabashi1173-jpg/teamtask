import { NextResponse } from "next/server";
import { resolveAppVersion, resolveCommitSha } from "@/lib/app-version";

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      appVersion: resolveAppVersion(),
      commitSha: resolveCommitSha(),
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      },
    },
  );
}
