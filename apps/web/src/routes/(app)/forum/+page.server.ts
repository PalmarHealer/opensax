import type { PageServerLoad } from "./$types";
export const load: PageServerLoad = async ({ locals, url }) => {
  const c = locals.client!;
  const group = url.searchParams.get("group");
  if (!group) return { entries: [], group: null };
  return { entries: await c.forum.list(group), group };
};
