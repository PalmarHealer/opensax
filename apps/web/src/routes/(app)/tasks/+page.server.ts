import { fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, url }) => {
  const c = locals.client!;
  const group = url.searchParams.get("group") || undefined;
  let tasks: Awaited<ReturnType<typeof c.tasks.list>> = [];
  let permissionError: string | null = null;
  try {
    tasks = await c.tasks.list(group);
  } catch (e) {
    permissionError = (e as Error).message;
  }
  return { tasks, group: group ?? null, permissionError };
};

const groupFromForm = (data: FormData): string | undefined =>
  data.get("group")?.toString() || undefined;

export const actions: Actions = {
  create: async ({ locals, request }) => {
    const c = locals.client!;
    const data = await request.formData();
    const title = data.get("title")?.toString().trim();
    if (!title) return fail(400, { error: "title required" });
    const due_raw = data.get("due_date")?.toString();
    const due_date = due_raw ? Math.floor(new Date(due_raw).getTime() / 1000) : undefined;
    try {
      await c.tasks.create(groupFromForm(data), { title, due_date });
    } catch (e) { return fail(403, { error: (e as Error).message }); }
    return { ok: true };
  },
  toggle: async ({ locals, request }) => {
    const c = locals.client!;
    const data = await request.formData();
    const id = data.get("id")?.toString();
    const completed = data.get("completed")?.toString() === "true";
    if (!id) return fail(400, { error: "id required" });
    try {
      await c.tasks.update(groupFromForm(data), id, { completed });
    } catch (e) { return fail(403, { error: (e as Error).message }); }
    return { ok: true };
  },
  remove: async ({ locals, request }) => {
    const c = locals.client!;
    const data = await request.formData();
    const id = data.get("id")?.toString();
    if (!id) return fail(400, { error: "id required" });
    try {
      await c.tasks.remove(groupFromForm(data), id);
    } catch (e) { return fail(403, { error: (e as Error).message }); }
    return { ok: true };
  },
};
