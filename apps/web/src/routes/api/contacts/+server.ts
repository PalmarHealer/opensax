import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

interface Contact {
  login: string;
  name_hr: string;
  online: boolean;
  groups: string[];
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: Contact[] }>();

export const GET: RequestHandler = async ({ locals }) => {
  const c = locals.client!;
  const myLogin = c.whoami()?.login ?? "";
  const cached = cache.get(myLogin);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return json({ contacts: cached.value });
  }

  const groups = c.groups();
  const memberLists = await Promise.all(
    groups.map((g) =>
      c.members.users(g.login)
        .then((users) => users.map((u) => ({
          login: u.login,
          name_hr: u.name_hr ?? u.login,
          online: Boolean(u.online ?? (u as { is_online?: number }).is_online),
          group: g.name_hr ?? g.login,
        })))
        .catch(() => [] as Array<{ login: string; name_hr: string; online: boolean; group: string }>),
    ),
  );

  const byLogin = new Map<string, Contact>();
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
  const contacts = [...byLogin.values()].sort((a, b) => a.name_hr.localeCompare(b.name_hr, "de"));
  cache.set(myLogin, { at: Date.now(), value: contacts });
  return json({ contacts });
};
