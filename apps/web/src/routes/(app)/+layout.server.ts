import { redirect } from "@sveltejs/kit";
import type { LayoutServerLoad } from "./$types";
import { userDisplay } from "@lernsax/core";
import { GROUP_COOKIE, groupScope, routeHasGroups, scopesFor } from "$lib/nav";
import { getUserIdForSession } from "$lib/server/sessionStore";
import { getOnboarding } from "$lib/server/onboardingStore";

/**
 * Put the remembered group back into the URL.
 *
 * Which group a page works in lives in `?group=`, so "remember what was last
 * open" means rewriting the address before the page loads — otherwise moving
 * from Wiki to Dateien would silently drop back to Persönlich. Only a request
 * that names no group at all is redirected; an explicit `?group=` is always
 * obeyed, and so is the empty cookie that clicking "Persönlich" writes.
 *
 * The remembered login is re-validated against the current membership and the
 * route's scopes, so a stale cookie — a group left since, or a school group on
 * a class-only page — is ignored rather than producing an empty view.
 */
function rememberedGroup(
  url: URL,
  remembered: string | undefined,
  groups: { login: string; type: number | string | null }[],
): string | null {
  if (!remembered || url.searchParams.has("group")) return null;
  if (!routeHasGroups(url.pathname)) return null;

  const allowed = new Set(scopesFor(url.pathname) ?? []);
  const group = groups.find((g) => g.login === remembered);
  if (!group || !allowed.has(groupScope(group))) return null;
  return remembered;
}

export const load: LayoutServerLoad = async ({ locals, url, cookies }) => {
  const client = locals.client;
  if (!client) return { user: null, displayName: "", email: "", groups: [], showOnboarding: false };
  const u = client.whoami();
  const groups = client.groups().map((g) => ({
    login: g.login,
    name: g.name_hr ?? g.login,
    type: g.type ?? null,
    effective_rights: g.effective_rights ?? [],
    member_rights: g.member_rights ?? [],
  }));

  const restore = rememberedGroup(url, cookies.get(GROUP_COOKIE), groups);
  if (restore) {
    const target = new URL(url);
    target.searchParams.set("group", restore);
    redirect(307, target.pathname + target.search);
  }

  return {
    user: u,
    displayName: userDisplay(u),
    email: u?.email ?? u?.login ?? "",
    groups,
    // Once per account, not per browser — see onboardingStore.
    showOnboarding: (() => {
      const user_id = getUserIdForSession(cookies.get("lernsax_sid") ?? null);
      return !!user_id && !getOnboarding(user_id);
    })(),
  };
};
