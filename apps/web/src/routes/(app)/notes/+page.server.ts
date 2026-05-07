import { fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, url }) => {
  const c = locals.client!;
  const group = url.searchParams.get("group") || undefined;
  let notes: Awaited<ReturnType<typeof c.notes.list>> = [];
  let permissionError: string | null = null;
  try {
    notes = await c.notes.list(group);
  } catch (e) {
    permissionError = (e as Error).message;
  }
  return { notes, group: group ?? null, permissionError };
};

const groupFromForm = (data: FormData): string | undefined =>
  data.get("group")?.toString() || undefined;

export const actions: Actions = {
  create: async ({ locals, request }) => {
    const c = locals.client!;
    const data = await request.formData();
    const text = data.get("text")?.toString().trim();
    if (!text) return fail(400, { error: "text required" });
    try {
      await c.notes.create(groupFromForm(data), {
        title: data.get("title")?.toString() || undefined,
        text,
        color: data.get("color")?.toString() || undefined,
      });
    } catch (e) { return fail(403, { error: (e as Error).message }); }
    return { ok: true };
  },
  update: async ({ locals, request }) => {
    const c = locals.client!;
    const data = await request.formData();
    const id = data.get("id")?.toString();
    if (!id) return fail(400, { error: "id required" });
    try {
      await c.notes.update(groupFromForm(data), id, {
        title: data.get("title")?.toString() || undefined,
        text: data.get("text")?.toString() || undefined,
        color: data.get("color")?.toString() || undefined,
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
      await c.notes.remove(groupFromForm(data), id);
    } catch (e) { return fail(403, { error: (e as Error).message }); }
    return { ok: true };
  },
};
