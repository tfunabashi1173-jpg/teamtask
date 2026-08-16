#!/usr/bin/env bash
set -euo pipefail

DOCKER_BIN="${DOCKER_BIN:-/usr/bin/docker}"
CONTAINER_LABEL="${TEAMTASK_CONTAINER_LABEL:-coolify.resourceName=teamtask}"
INTERNAL_BASE_URL="${TEAMTASK_INTERNAL_BASE_URL:-http://127.0.0.1:3000}"

container_id="$("$DOCKER_BIN" ps -q --filter "label=${CONTAINER_LABEL}" | head -n 1)"

if [[ -z "${container_id}" ]]; then
  echo "teamtask notification trigger failed: no running container found for label ${CONTAINER_LABEL}" >&2
  exit 1
fi

"$DOCKER_BIN" exec \
  -e "TEAMTASK_INTERNAL_BASE_URL=${INTERNAL_BASE_URL}" \
  -i "$container_id" \
  node <<'NODE'
const baseUrl = process.env.TEAMTASK_INTERNAL_BASE_URL || "http://127.0.0.1:3000";
const cronSecret = process.env.CRON_SECRET;
const endpoints = [
  "/api/cron/morning-notifications",
  "/api/cron/evening-notifications",
];

if (!cronSecret) {
  console.error("teamtask notification trigger failed: CRON_SECRET is not set in the app container");
  process.exit(1);
}

let failed = false;

for (const endpoint of endpoints) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);

  try {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      headers: {
        authorization: `Bearer ${cronSecret}`,
      },
      signal: controller.signal,
    });
    const body = await response.text();
    const preview = body.length > 1000 ? `${body.slice(0, 1000)}...` : body;

    console.log(`${new Date().toISOString()} ${endpoint} status=${response.status} body=${preview}`);

    if (!response.ok) {
      failed = true;
    }
  } catch (error) {
    failed = true;
    console.error(`${new Date().toISOString()} ${endpoint} error=${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timeout);
  }
}

if (failed) {
  process.exit(1);
}
NODE
