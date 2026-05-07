import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";

const groupFromForm = (data: FormData): string | undefined =>
  data.get("group")?.toString() || undefined;

export const load: PageServerLoad = async ({ locals, url }) => {
  const c = locals.client!;
  let group = url.searchParams.get("group");
  const thread = url.searchParams.get("thread");

  if (!group) {
    const first = c.groups()[0];
    if (first) {
      const u = new URL(url);
      u.searchParams.set("group", first.login);
      throw redirect(303, u.pathname + u.search);
    }
    return { threads: [], replies: [], root: null, group: null, thread: null };
  }

  if (thread) {
    const [rootDirect, replies] = await Promise.all([
      c.forum.get(group, thread).catch(() => null),
      c.forum.list(group, thread).catch(() => []),
    ]);
    // Some LernSax instances return the root as the first list entry; if
    // get_entry didn't surface a usable record, fall back to the list.
    const usable = rootDirect && (rootDirect.title || rootDirect.text) ? rootDirect : null;
    const root = usable ?? replies.find((r) => r.id === thread) ?? null;
    return { threads: [], replies, root, group, thread };
  }

  const threads = await c.forum.list(group).catch(() => []);
  return { threads, replies: [], root: null, group, thread: null };
};

export const actions: Actions = {
  post: async ({ locals, request }) => {
    const c = locals.client!;
    const data = await request.formData();
    const group = groupFromForm(data);
    if (!group) return fail(400, { error: "group required" });
    const title = data.get("title")?.toString().trim();
    const text = data.get("text")?.toString().trim();
    if (!title || !text) return fail(400, { error: "title+text required" });
    const parent_id = data.get("parent_id")?.toString() || undefined;
    try {
      await c.forum.post(group, { title, text, parent_id });
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
      await c.forum.remove(group, id);
    } catch (e) { return fail(403, { error: (e as Error).message }); }
    return { ok: true };
  },
};
