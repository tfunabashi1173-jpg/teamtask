import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";

const DEFAULT_SCHEMA = process.env.SUPABASE_DB_SCHEMA || "teamtask";
const DEFAULT_BUCKET = process.env.SUPABASE_TASK_PHOTO_BUCKET || "task-photos";
loadDotEnv(path.join(process.cwd(), ".env.local"));
loadDotEnv(path.join(process.cwd(), ".env"));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const bucketName = process.env.SUPABASE_TASK_PHOTO_BUCKET || DEFAULT_BUCKET;
const dbSchema = process.env.SUPABASE_DB_SCHEMA || DEFAULT_SCHEMA;
const concurrency = parsePositiveInt(process.env.BACKFILL_THUMBNAIL_CONCURRENCY, 4);
const rowLimit = parsePositiveInt(process.env.BACKFILL_THUMBNAIL_LIMIT, 0);

if (!supabaseUrl || !serviceRoleKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

if (typeof globalThis.WebSocket === "undefined") {
  globalThis.WebSocket = ws;
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  db: { schema: dbSchema },
});

const targets = [
  { table: "task_photos", label: "completion" },
  { table: "task_reference_photos", label: "reference" },
];

let totalUpdated = 0;
let totalFailed = 0;

for (const target of targets) {
  let query = supabase
    .from(target.table)
    .select("id,storage_path")
    .is("thumbnail_storage_path", null)
    .order("created_at", { ascending: true });

  if (rowLimit > 0) {
    query = query.limit(rowLimit);
  }

  const { data, error } = await query;

  if (error) {
    console.error(`[${target.table}] query failed: ${error.message}`);
    totalFailed += 1;
    continue;
  }

  const rows = data ?? [];
  console.log(`[${target.label}] pending=${rows.length} concurrency=${concurrency}`);

  for (let index = 0; index < rows.length; index += concurrency) {
    const batch = rows.slice(index, index + concurrency);
    const results = await Promise.allSettled(batch.map((row) => backfillRow(target, row)));

    for (const result of results) {
      if (result.status === "fulfilled") {
        totalUpdated += 1;
      } else {
        totalFailed += 1;
        console.error(result.reason instanceof Error ? result.reason.message : String(result.reason));
      }
    }
  }
}

console.log(`done: updated=${totalUpdated} failed=${totalFailed}`);

function buildTaskThumbnailPath(storagePath) {
  return `${storagePath}__thumb.jpg`;
}

async function createThumbnailBuffer(input) {
  return sharp(input)
    .rotate()
    .resize({ width: 320, height: 320, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 60 })
    .toBuffer();
}

async function backfillRow(target, row) {
  const thumbnailStoragePath = buildTaskThumbnailPath(row.storage_path);
  const downloadResult = await supabase.storage.from(bucketName).download(row.storage_path);
  if (downloadResult.error || !downloadResult.data) {
    throw new Error(`[${target.label}] failed ${row.id}: ${downloadResult.error?.message || "download failed"}`);
  }

  const sourceBuffer = Buffer.from(await downloadResult.data.arrayBuffer());
  const thumbnailBuffer = await createThumbnailBuffer(sourceBuffer);

  const uploadResult = await supabase.storage
    .from(bucketName)
    .upload(thumbnailStoragePath, thumbnailBuffer, {
      contentType: "image/jpeg",
      upsert: true,
    });

  if (uploadResult.error) {
    throw new Error(`[${target.label}] failed ${row.id}: ${uploadResult.error.message}`);
  }

  const updateResult = await supabase
    .from(target.table)
    .update({ thumbnail_storage_path: thumbnailStoragePath })
    .eq("id", row.id);

  if (updateResult.error) {
    throw new Error(`[${target.label}] failed ${row.id}: ${updateResult.error.message}`);
  }

  console.log(`[${target.label}] ok ${row.id}`);
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    if (process.env[key]) continue;
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function toErrorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}
