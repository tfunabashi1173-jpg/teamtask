import { NextResponse } from "next/server";
import { writeSessionCookie } from "@/lib/auth/server-session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type StoredSessionPayload = {
  lineUserId: string;
  displayName: string | null;
  pictureUrl?: string | null;
};

function isStoredSessionPayload(value: unknown): value is StoredSessionPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Record<string, unknown>;
  return (
    typeof payload.lineUserId === "string" &&
    ("displayName" in payload ? typeof payload.displayName === "string" || payload.displayName === null : true) &&
    (!("pictureUrl" in payload) ||
      typeof payload.pictureUrl === "string" ||
      payload.pictureUrl === null)
  );
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { attemptId?: string } | null;
  const attemptId = body?.attemptId;

  if (!attemptId) {
    return NextResponse.json({ error: "attemptId is required." }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const result = await supabase
    .from("line_login_attempts")
    .select("id,status,expires_at,session_payload")
    .eq("id", attemptId)
    .maybeSingle();

  if (result.error) {
    return NextResponse.json({ error: "Failed to load login attempt." }, { status: 500 });
  }

  if (!result.data) {
    return NextResponse.json({ error: "Login attempt not found." }, { status: 404 });
  }

  if (new Date(result.data.expires_at).getTime() <= Date.now()) {
    return NextResponse.json({ error: "Login attempt expired." }, { status: 410 });
  }

  if (result.data.status === "pending") {
    return NextResponse.json({ error: "Login attempt is not completed yet." }, { status: 409 });
  }

  if (result.data.status === "consumed") {
    return NextResponse.json({ error: "Login attempt already consumed." }, { status: 409 });
  }

  if (!isStoredSessionPayload(result.data.session_payload)) {
    return NextResponse.json({ error: "Login session payload is invalid." }, { status: 422 });
  }

  await writeSessionCookie(result.data.session_payload);

  await supabase
    .from("line_login_attempts")
    .update({
      status: "consumed",
      consumed_at: new Date().toISOString(),
    })
    .eq("id", attemptId);

  return NextResponse.json({
    ok: true,
    user: {
      lineUserId: result.data.session_payload.lineUserId,
      displayName: result.data.session_payload.displayName,
      pictureUrl: result.data.session_payload.pictureUrl ?? null,
    },
  });
}
