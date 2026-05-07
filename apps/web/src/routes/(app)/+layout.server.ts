import type { LayoutServerLoad } from "./$types";
import { userDisplay } from "@lernsax/core";

export const load: LayoutServerLoad = async ({ locals }) => {
  const client = locals.client;
  if (!client) return { user: null, displayName: "", email: "", groups: [] };
  const u = client.whoami();
  return {
    user: u,
    displayName: userDisplay(u),
    email: u?.email ?? u?.login ?? "",
    groups: client.groups().map((g) => ({
      login: g.login,
      name: g.name_hr ?? g.login,
      type: g.type ?? null,
      effective_rights: g.effective_rights ?? [],
      member_rights: g.member_rights ?? [],
    })),
  };
};
