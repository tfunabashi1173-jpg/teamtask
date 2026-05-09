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
  const { data, error } = await supabase
    .from(target.table)
    .select("id,storage_path")
    .is("thumbnail_storage_path", null)
    .order("created_at", { ascending: true });

  if (error) {
    console.error(`[${target.table}] query failed: ${error.message}`);
    totalFailed += 1;
    continue;
  }

  for (const row of data ?? []) {
    const thumbnailStoragePath = buildTaskThumbnailPath(row.storage_path);

    try {
      const downloadResult = await supabase.storage.from(bucketName).download(row.storage_path);
      if (downloadResult.error || !downloadResult.data) {
        throw new Error(downloadResult.error?.message || "download failed");
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
        throw new Error(uploadResult.error.message);
      }

      const updateResult = await supabase
        .from(target.table)
        .update({ thumbnail_storage_path: thumbnailStoragePath })
        .eq("id", row.id);

      if (updateResult.error) {
        throw new Error(updateResult.error.message);
      }

      totalUpdated += 1;
      console.log(`[${target.label}] ok ${row.id}`);
    } catch (error) {
      totalFailed += 1;
      console.error(`[${target.label}] failed ${row.id}: ${toErrorMessage(error)}`);
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
