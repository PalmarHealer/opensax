import type { PageServerLoad } from "./$types";
import { getUserIdForSession } from "$lib/server/sessionStore";
import { getPayload, loadConfig } from "$lib/server/davinciStore";
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

  try {
    const { payload, fetchedAt, cached } = await getPayload(user_id, cfg, {
      force: url.searchParams.has("refresh"),
    });

    // An explicit pick in Settings wins; otherwise fall back to whatever object
    // the server tied our login to.
    const auto = personalFilter(payload);
    const classCode = cfg.classCode || (auto?.type === "class" ? auto.code : undefined);
    const teacherCode = cfg.teacherCode || (auto?.type === "teacher" ? auto.code : undefined);

    const entries: DaVinciEntry[] = expandDaVinciDays(payload, {
      from: weekStart,
      to: weekEnd,
      classCode,
      teacherCode,
      includeSupervisions: cfg.includeSupervisions ?? false,
    });

    const span = payload.result?.displaySchedule?.weekspan;
    const dayCount = Math.min(7, Math.max(5, (span?.weekdayEnd ?? 5) - (span?.weekdayStart ?? 1) + 1));
    const days = Array.from({ length: dayCount }, (_, i) => {
      const date = addDays(weekStart, i);
      return { date, entries: entries.filter((e) => e.date === date) };
    });

    return {
      configured: true as const,
      weekStart,
      weekEnd,
      today,
      days,
      filter: { classCode, teacherCode, auto: auto?.type ?? null },
      info: describeDaVinci(payload),
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
      days: [],
      filter: { classCode: cfg.classCode, teacherCode: cfg.teacherCode, auto: null },
      info: null,
      fetchedAt: 0,
      cached: false,
      error: (e as Error).message,
    };
  }
};
