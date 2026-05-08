import { fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const c = locals.client!;
  const myLogin = c.whoami()?.login ?? "";

  const [history, contactsRaw] = await Promise.all([
    c.messenger.history({}).catch(() => []),
    c.messenger.users(false).catch(() => []),
  ]);

  // Aggregate members from each group/class the user belongs to.
  const groups = c.groups();
  const memberLists = await Promise.all(
    groups.map((g) =>
      c.members
        .users(g.login)
        .then((users) =>
          users.map((u) => ({
            login: u.login,
            name_hr: u.name_hr ?? u.login,
            online: Boolean(u.online ?? (u as { is_online?: number }).is_online),
            group: g.name_hr ?? g.login,
          })),
        )
        .catch(() => [] as Array<{ login: string; name_hr: string; online: boolean; group: string }>),
    ),
  );

  // Merge by login (keep online if any group reports online; concat group labels).
  const byLogin = new Map<string, { login: string; name_hr: string; online: boolean; groups: string[] }>();
  for (const arr of memberLists) {
    for (const m of arr) {
      if (m.login === myLogin) continue;
      const ex = byLogin.get(m.login);
      if (ex) {
        if (m.online) ex.online = true;
        if (!ex.groups.includes(m.group)) ex.groups.push(m.group);
      } else {
        byLogin.set(m.login, { login: m.login, name_hr: m.name_hr, online: m.online, groups: [m.group] });
      }
    }
  }
  const members = [...byLogin.values()].sort((a, b) => a.name_hr.localeCompare(b.name_hr, "de"));

  return { history, contacts: contactsRaw, members };
};

export const actions: Actions = {
  send: async ({ locals, request }) => {
    const c = locals.client!;
    const data = await request.formData();
    const to_login = data.get("to_login")?.toString();
    const text = data.get("text")?.toString().trim();
    if (!to_login || !text) return fail(400, { error: "to_login+text required" });
    try {
      await c.messenger.send(to_login, text);
    } catch (e) {
      return fail(502, { error: (e as Error).message || "send failed", to_login, text });
    }
    return { ok: true };
  },
};
