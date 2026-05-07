import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";

const groupFromForm = (data: FormData): string | undefined =>
  data.get("group")?.toString() || undefined;

export const load: PageServerLoad = async ({ locals, url }) => {
  const c = locals.client!;
  let group = url.searchParams.get("group");
  const kind = (url.searchParams.get("kind") ?? "general") as "general" | "teacher" | "pupil";

  // Default to first group with effective board access
  if (!group) {
    const first = c.groups()[0];
    if (first) {
      const u = new URL(url);
      u.searchParams.set("group", first.login);
      throw redirect(303, u.pathname + u.search);
    }
    return { entries: [], group: null, kind };
  }

  const entries = await c.board.list(group, kind).catch(() => []);
  return { entries, group, kind };
};

export const actions: Actions = {
  post: async ({ locals, request, url }) => {
    const c = locals.client!;
    const kind = (url.searchParams.get("kind") ?? "general") as "general" | "teacher" | "pupil";
    const data = await request.formData();
    const group = groupFromForm(data);
    if (!group) return fail(400, { error: "group required" });
    const title = data.get("title")?.toString().trim();
    const text = data.get("text")?.toString().trim();
    if (!title || !text) return fail(400, { error: "title+text required" });
    const colorRaw = data.get("color")?.toString();
    const color = colorRaw ? Number.parseInt(colorRaw, 10) : undefined;
    try {
      await c.board.post(group, { title, text, color: Number.isFinite(color) ? color : undefined }, kind);
    } catch (e) { return fail(403, { error: (e as Error).message }); }
    return { ok: true };
  },
  remove: async ({ locals, request, url }) => {
    const c = locals.client!;
    const kind = (url.searchParams.get("kind") ?? "general") as "general" | "teacher" | "pupil";
    const data = await request.formData();
    const group = groupFromForm(data);
    if (!group) return fail(400, { error: "group required" });
    const id = data.get("id")?.toString();
    if (!id) return fail(400, { error: "id required" });
    try {
      await c.board.remove(group, id, kind);
    } catch (e) { return fail(403, { error: (e as Error).message }); }
    return { ok: true };
  },
};
