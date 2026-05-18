export const FLOOR_MIN_LEVEL = -3;
export const FLOOR_MAX_LEVEL = 30;
export const DEFAULT_FLOOR_RANGE_START = FLOOR_MAX_LEVEL;
export const DEFAULT_FLOOR_RANGE_END = FLOOR_MIN_LEVEL;

export type FloorOption = {
  value: number;
  label: string;
};

export function clampFloorLevel(value: number) {
  return Math.min(FLOOR_MAX_LEVEL, Math.max(FLOOR_MIN_LEVEL, value));
}

export function normalizeFloorRange(
  start: number | null | undefined,
  end: number | null | undefined,
) {
  const normalizedStart = clampFloorLevel(start ?? DEFAULT_FLOOR_RANGE_START);
  const normalizedEnd = clampFloorLevel(end ?? DEFAULT_FLOOR_RANGE_END);
  return normalizedStart >= normalizedEnd
    ? { start: normalizedStart, end: normalizedEnd }
    : { start: normalizedEnd, end: normalizedStart };
}

export function formatFloorLabel(level: number | null | undefined) {
  if (level === null || level === undefined || Number.isNaN(level)) {
    return "";
  }

  if (level < 0) {
    return `B${Math.abs(level)}F`;
  }

  return `${level}F`;
}

export function parseFloorLevel(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number" && Number.isInteger(value)) {
    return clampFloorLevel(value);
  }

  const stringValue = String(value).trim().toUpperCase();
  if (!stringValue) {
    return null;
  }

  const basementMatch = stringValue.match(/^B(\d+)F?$/);
  if (basementMatch) {
    return clampFloorLevel(-Number(basementMatch[1]));
  }

  const floorMatch = stringValue.match(/^(\d+)F?$/);
  if (floorMatch) {
    return clampFloorLevel(Number(floorMatch[1]));
  }

  return null;
}

export function buildFloorOptions(
  start: number | null | undefined,
  end: number | null | undefined,
): FloorOption[] {
  const normalized = normalizeFloorRange(start, end);
  const options: FloorOption[] = [];

  for (let level = normalized.start; level >= normalized.end; level -= 1) {
    if (level === 0) continue;
    options.push({ value: level, label: formatFloorLabel(level) });
  }

  return options;
}

export function shiftFloorLevel(
  floorLevel: number | null | undefined,
  delta: -1 | 1,
  start: number | null | undefined,
  end: number | null | undefined,
) {
  if (floorLevel === null || floorLevel === undefined) {
    return null;
  }

  const normalized = normalizeFloorRange(start, end);
  let nextLevel = floorLevel + delta;
  if (floorLevel === 1 && delta === -1) {
    nextLevel = -1;
  } else if (floorLevel === -1 && delta === 1) {
    nextLevel = 1;
  }

  if (nextLevel === 0) {
    nextLevel = delta > 0 ? 1 : -1;
  }

  if (nextLevel > normalized.start || nextLevel < normalized.end) {
    return floorLevel;
  }

  return nextLevel;
}
