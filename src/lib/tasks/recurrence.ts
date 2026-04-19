export type RecurrenceFrequency = "daily" | "weekly" | "monthly";

/** タイトルを正規化（スペース除去・小文字化） */
function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[\s　]+/g, "");
}

/** bigram集合を生成 */
function bigrams(s: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) {
    set.add(s.slice(i, i + 2));
  }
  return set;
}

/**
 * Dice係数によるタイトル類似度 (0〜1)
 * PostgreSQL の pg_trgm.similarity() と同じアルゴリズム（trigram版のbigram適用）
 */
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (na === nb) return 1;
  if (na.length < 2 || nb.length < 2) return 0;
  const ba = bigrams(na);
  const bb = bigrams(nb);
  let intersection = 0;
  for (const g of ba) {
    if (bb.has(g)) intersection++;
  }
  return (2 * intersection) / (ba.size + bb.size);
}

export type RecurrenceInput = {
  frequency: RecurrenceFrequency;
  interval: number;
  startDate: string;
  endDate: string;
  daysOfWeek?: number[];
  dayOfMonth?: number | null;
};

function toUtcDate(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

function formatUtcDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addUtcMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function dayOfWeekFromDate(value: string) {
  return toUtcDate(value).getUTCDay();
}

export function normalizeRecurrence(input: RecurrenceInput): RecurrenceInput {
  const interval = Number.isFinite(input.interval) ? Math.max(1, Math.trunc(input.interval)) : 1;
  const daysOfWeek =
    input.frequency === "weekly"
      ? Array.from(new Set((input.daysOfWeek ?? [dayOfWeekFromDate(input.startDate)]).sort()))
      : undefined;
  const dayOfMonth =
    input.frequency === "monthly"
      ? Math.min(31, Math.max(1, input.dayOfMonth ?? toUtcDate(input.startDate).getUTCDate()))
      : null;

  return {
    frequency: input.frequency,
    interval,
    startDate: input.startDate,
    endDate: input.endDate,
    daysOfWeek,
    dayOfMonth,
  };
}

export function startDateMatchesWeeklyRule(input: RecurrenceInput): boolean {
  if (input.frequency !== "weekly") return true;
  const days = input.daysOfWeek?.length ? input.daysOfWeek : null;
  if (!days) return true;
  return days.includes(toUtcDate(input.startDate).getUTCDay());
}

export function generateFutureOccurrenceDates(input: RecurrenceInput) {
  const rule = normalizeRecurrence(input);
  const start = toUtcDate(rule.startDate);
  const end = toUtcDate(rule.endDate);
  const dates: string[] = [];

  if (end < start) {
    return dates;
  }

  if (rule.frequency === "daily") {
    for (let cursor = addUtcDays(start, rule.interval); cursor <= end; cursor = addUtcDays(cursor, rule.interval)) {
      dates.push(formatUtcDate(cursor));
    }
    return dates;
  }

  if (rule.frequency === "weekly") {
    const days = rule.daysOfWeek?.length ? rule.daysOfWeek : [start.getUTCDay()];

    // Start from start date itself — the caller is responsible for handling whether
    // the start date was already created as a separate task.
    for (let cursor = start; cursor <= end; cursor = addUtcDays(cursor, 1)) {
      const diffDays = Math.floor((cursor.getTime() - start.getTime()) / 86_400_000);
      const weekOffset = Math.floor(diffDays / 7);
      if (weekOffset % rule.interval !== 0) continue;
      if (!days.includes(cursor.getUTCDay())) continue;
      dates.push(formatUtcDate(cursor));
    }

    return dates;
  }

  const targetDay = rule.dayOfMonth ?? start.getUTCDate();
  for (
    let monthCursor = addUtcMonths(start, rule.interval);
    monthCursor <= end;
    monthCursor = addUtcMonths(monthCursor, rule.interval)
  ) {
    const year = monthCursor.getUTCFullYear();
    const month = monthCursor.getUTCMonth();
    const candidate = new Date(Date.UTC(year, month, targetDay));
    if (candidate.getUTCMonth() !== month) continue;
    if (candidate <= start || candidate > end) continue;
    dates.push(formatUtcDate(candidate));
  }

  return dates;
}
