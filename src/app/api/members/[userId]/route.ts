import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ userId: string }> },
) {
  const { sessionUser, errorResponse } = await requireSession();
  if (errorResponse || !sessionUser) {
    return errorResponse;
  }

  const { userId } = await context.params;
  const supabase = createSupabaseAdminClient();

  const adminResult = await supabase
    .from("app_users")
    .select("id,role")
    .eq("line_user_id", sessionUser.lineUserId)
    .single();

  if (adminResult.error || adminResult.data.role !== "admin") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  await supabase
    .from("app_users")
    .update({
      is_active: false,
      deactivated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  await supabase
    .from("workspace_members")
    .update({
      is_active: false,
      left_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("is_active", true);

  await supabase
    .from("group_members")
    .update({
      is_active: false,
      left_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("is_active", true);

  return NextResponse.json({ ok: true });
}
