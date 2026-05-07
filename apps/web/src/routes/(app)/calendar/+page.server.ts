import { fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, url }) => {
  const c = locals.client!;
  const group = url.searchParams.get("group") || undefined;
  const ymParam = url.searchParams.get("ym");
  const today = new Date();
  let year: number, month0: number;
  if (ymParam && /^\d{4}-\d{2}$/.test(ymParam)) {
    const [y, m] = ymParam.split("-").map((s) => Number.parseInt(s, 10));
    year = y!;
    month0 = m! - 1;
  } else {
    year = today.getFullYear();
    month0 = today.getMonth();
  }

  let entries: Awaited<ReturnType<typeof c.calendar.list>> = [];
  let permissionError: string | null = null;
  try {
    entries = await c.calendar.list({ group });
  } catch (e) {
    permissionError = (e as Error).message;
  }
  const holidays = await c.calendar.holidays().catch(() => []);

  return { group: group ?? null, year, month0, entries, holidays, permissionError };
};

const groupFromForm = (data: FormData): string | undefined =>
  data.get("group")?.toString() || undefined;

export const actions: Actions = {
  create: async ({ locals, request }) => {
    const c = locals.client!;
    const data = await request.formData();
    const title = data.get("title")?.toString().trim();
    const startStr = data.get("start")?.toString();
    const endStr = data.get("end")?.toString();
    const allDay = data.get("all_day")?.toString() === "true";
    if (!title || !startStr) return fail(400, { error: "title+start required" });
    const start = Math.floor(new Date(startStr).getTime() / 1000);
    const end = endStr ? Math.floor(new Date(endStr).getTime() / 1000) : start + 3600;
    try {
      await c.calendar.create(groupFromForm(data), {
        title,
        start_date: start,
        end_date: end,
        is_all_day: allDay ? 1 : 0,
        description: data.get("description")?.toString() || undefined,
        location: data.get("location")?.toString() || undefined,
      });
    } catch (e) { return fail(403, { error: (e as Error).message }); }
    return { ok: true };
  },
  remove: async ({ locals, request }) => {
    const c = locals.client!;
    const data = await request.formData();
    const id = data.get("id")?.toString();
    if (!id) return fail(400, { error: "id required" });
    try {
      await c.calendar.remove(groupFromForm(data), id);
    } catch (e) { return fail(403, { error: (e as Error).message }); }
    return { ok: true };
  },
};
