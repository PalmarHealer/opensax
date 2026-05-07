import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";

const groupFromForm = (data: FormData): string | undefined =>
  data.get("group")?.toString() || undefined;

export const load: PageServerLoad = async ({ locals, url }) => {
  const c = locals.client!;
  let group = url.searchParams.get("group");
  const pageId = url.searchParams.get("page");

  if (!group) {
    const first = c.groups()[0];
    if (first) {
      const u = new URL(url);
      u.searchParams.set("group", first.login);
      throw redirect(303, u.pathname + u.search);
    }
    return { pages: [], current: null, group: null, pageId: null };
  }

  const pages = await c.wiki.list(group).catch(() => []);
  const current = pageId ? await c.wiki.page(group, pageId).catch(() => null) : null;
  return { pages, current, group, pageId };
};

export const actions: Actions = {
  create: async ({ locals, request }) => {
    const c = locals.client!;
    const data = await request.formData();
    const group = groupFromForm(data);
    if (!group) return fail(400, { error: "group required" });
    const title = data.get("title")?.toString().trim();
    const text = data.get("text")?.toString() ?? "";
    if (!title) return fail(400, { error: "title required" });
    try {
      await c.wiki.create(group, { title, text });
    } catch (e) { return fail(403, { error: (e as Error).message }); }
    return { ok: true };
  },
  update: async ({ locals, request }) => {
    const c = locals.client!;
    const data = await request.formData();
    const group = groupFromForm(data);
    if (!group) return fail(400, { error: "group required" });
    const id = data.get("id")?.toString();
    if (!id) return fail(400, { error: "id required" });
    const title = data.get("title")?.toString();
    const text = data.get("text")?.toString();
    try {
      await c.wiki.update(group, id, { title, text });
    } catch (e) { return fail(403, { error: (e as Error).message }); }
    return { ok: true };
  },
  remove: async ({ locals, request }) => {
    const c = locals.client!;
    const data = await request.formData();
    const group = groupFromForm(data);
    if (!group) return fail(400, { error: "group required" });
    const id = data.get("id")?.toString();
    if (!id) return fail(400, { error: "id required" });
    try {
      await c.wiki.remove(group, id);
    } catch (e) { return fail(403, { error: (e as Error).message }); }
    return { ok: true };
  },
};
