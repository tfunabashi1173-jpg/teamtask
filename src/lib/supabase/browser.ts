export function createSupabaseBrowserClient(): any {
  // Realtime is disabled after migrating away from Supabase Realtime.
  // UI falls back to polling/focus-sync paths already implemented in task-board.
  return null;
}
