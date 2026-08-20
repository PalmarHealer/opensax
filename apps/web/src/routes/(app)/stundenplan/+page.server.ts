import type { PageServerLoad } from "./$types";
import { getUserIdForSession } from "$lib/server/sessionStore";
import { getHtml, getPayload, loadConfig } from "$lib/server/davinciStore";
import {
  describeDaVinci,
  expandDaVinciDays,
  personalFilter,
  type DaVinciEntry,
} from "@lernsax/core";

/** Monday of the week `iso` falls into, as "YYYY-MM-DD". */
function mondayOf(iso: string): string {
  // `?week=` is user input; a malformed value would otherwise blow up in
  // toISOString() and turn a typo into a 500.
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return mondayOf(todayIso());
  // getUTCDay: 0 = Sunday, so Sunday belongs to the week that started 6 days ago.
  const shift = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** A time window that occurs somewhere in the displayed week. */
export interface Block {
  /** "HH:MM". */
  start: string;
  end: string;
  /** Period label of the block, e.g. "3-4". */
  period?: string;
}

export interface DaySlot {
  /** Everything happening in this window. */
  entries: DaVinciEntry[];
  /**
   * True when the class is genuinely split into groups taught at the same
   * time — those belong side by side.
   *
   * Not every crowded slot qualifies: a lesson moving out and its replacement
   * moving in also share the window, but they're a sequence, not a pair, so
   * they stay stacked. Counting entries that still take place separates the
   * two without another round-trip to the vendor's block ids.
   */
  parallel: boolean;
}

/**
 * Identity of the slot an entry occupies.
 *
 * The period is part of it, not just the clock times: HTML exports print
 * period numbers and no times at all, so keying on times alone would collapse
 * an entire week into a single row.
 */
const blockKey = (b: { start: string; end: string; period?: string }) =>
  `${b.start}|${b.end}|${b.period ?? ""}`;

/** Leading number of a period label, so "10" sorts after "9" and not before. */
function periodOrder(period?: string): number {
  const n = Number.parseInt(period ?? "", 10);
  return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
}

/**
 * The distinct time windows used anywhere in the week, in chronological order.
 *
 * These become the grid's rows, so the same period lands at the same height in
 * every day column and the week can be read across. Days that don't use a
 * window get an empty cell rather than pulling their later lessons upwards.
 */
function collectBlocks(entries: DaVinciEntry[]): Block[] {
  const byKey = new Map<string, Block>();
  for (const e of entries) {
    const key = blockKey(e);
    if (!byKey.has(key)) byKey.set(key, { start: e.start, end: e.end, period: e.period });
  }
  // Times first where they exist; period order carries the rest, which is all
  // an HTML export gives us.
  return [...byKey.values()].sort((a, b) =>
    a.start.localeCompare(b.start)
    || periodOrder(a.period) - periodOrder(b.period)
    || a.end.localeCompare(b.end));
}

/** Bucket one day's entries into the shared block grid. `null` = free. */
function cellsFor(entries: DaVinciEntry[], blocks: Block[]): (DaySlot | null)[] {
  return blocks.map((b) => {
    const hit = entries.filter((e) => blockKey(e) === blockKey(b));
    if (hit.length === 0) return null;
    return {
      entries: hit,
      parallel: hit.filter((e) => e.change?.type !== "cancelled").length > 1,
    };
  });
}

function todayIso(): string {
  // The plan is a local-time artefact; using the server's local date keeps
  // "today" aligned with what the user sees on the wall clock.
  const now = new Date();
  const off = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - off).toISOString().slice(0, 10);
}

export const load: PageServerLoad = async ({ locals, url }) => {
  const user_id = getUserIdForSession(locals.sessionId);
  const cfg = user_id ? loadConfig(user_id) : null;

  const today = todayIso();
  const weekStart = mondayOf(url.searchParams.get("week") || today);
  const weekEnd = addDays(weekStart, 6);

  if (!user_id || !cfg) {
    return { configured: false as const, weekStart, weekEnd, today };
  }

  const force = url.searchParams.has("refresh");

  try {
    let entries: DaVinciEntry[];
    let classCode = cfg.classCode;
    let teacherCode = cfg.teacherCode;
    let auto: ReturnType<typeof personalFilter> = null;
    let info: ReturnType<typeof describeDaVinci> | null = null;
    let fetchedAt: number;
    let cached: boolean;
    let notes: Record<string, string> = {};
    let dayCount = 5;

    if (cfg.sourceType === "html") {
      // A published export carries only what deviates from the timetable, and
      // no login — so there is nobody for the server to identify us as. The
      // class has to come from Settings.
      const res = await getHtml(user_id, cfg, { force });
      fetchedAt = res.fetchedAt;
      cached = res.cached;
      notes = res.notes;
      entries = res.entries.filter(
        (e) => e.date >= weekStart && e.date <= weekEnd
          && (!classCode || e.classes.includes(classCode))
          && (!teacherCode || e.teachers.includes(teacherCode)
            || (e.change?.absentTeachers ?? []).includes(teacherCode)),
      );
      info = {
        scheduleDescription: "Vertretungsplan (HTML-Export)",
        serverVersion: res.generatedAt ? `Export ${res.generatedAt}` : undefined,
        profile: "html",
        lessonCount: entries.length,
        classCount: new Set(res.entries.flatMap((e) => e.classes)).size,
        teacherCount: new Set(res.entries.flatMap((e) => e.teachers)).size,
      };
    } else {
      const res = await getPayload(user_id, cfg, { force });
      fetchedAt = res.fetchedAt;
      cached = res.cached;

      // An explicit pick in Settings wins; otherwise fall back to whatever
      // object the server tied our login to.
      auto = personalFilter(res.payload);
      classCode = cfg.classCode || (auto?.type === "class" ? auto.code : undefined);
      teacherCode = cfg.teacherCode || (auto?.type === "teacher" ? auto.code : undefined);

      entries = expandDaVinciDays(res.payload, {
        from: weekStart,
        to: weekEnd,
        classCode,
        teacherCode,
        includeSupervisions: cfg.includeSupervisions ?? false,
      });

      info = describeDaVinci(res.payload);
      const span = res.payload.result?.displaySchedule?.weekspan;
      dayCount = Math.min(7, Math.max(5, (span?.weekdayEnd ?? 5) - (span?.weekdayStart ?? 1) + 1));
    }

    const blocks = collectBlocks(entries);
    const days = Array.from({ length: dayCount }, (_, i) => {
      const date = addDays(weekStart, i);
      return {
        date,
        cells: cellsFor(entries.filter((e) => e.date === date), blocks),
        note: notes[date],
      };
    });

    return {
      configured: true as const,
      weekStart,
      weekEnd,
      today,
      days,
      blocks,
      sourceType: cfg.sourceType ?? "infoserver",
      filter: { classCode, teacherCode, auto: auto?.type ?? null },
      info,
      fetchedAt,
      cached,
      error: null as string | null,
    };
  } catch (e) {
    return {
      configured: true as const,
      weekStart,
      weekEnd,
      today,
      days: [] as { date: string; cells: (DaySlot | null)[]; note?: string }[],
      blocks: [] as Block[],
      sourceType: cfg.sourceType ?? "infoserver",
      filter: { classCode: cfg.classCode, teacherCode: cfg.teacherCode, auto: null },
      info: null,
      fetchedAt: 0,
      cached: false,
      error: (e as Error).message,
    };
  }
};
