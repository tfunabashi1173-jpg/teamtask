import { NextRequest, NextResponse } from "next/server";

function isAuthorized(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;

  return request.headers.get("authorization") === `Bearer ${cronSecret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    mode: "local_notification_only",
    results: [],
  });
}
