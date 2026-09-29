import type { LernSaxClient, MemberOf } from "@lernsax/core";
import type { IdentityClaims } from "./connectionStore";

function groupType(g: MemberOf): number {
  return typeof g.type === "string" ? Number.parseInt(g.type, 10) : g.type ?? 0;
}

function groupsOfType(groups: MemberOf[], type: number) {
  return groups
    .filter((g) => groupType(g) === type)
    .map((g) => ({ id: g.login, name: g.name_hr ?? g.login }));
}

/**
 * Snapshot of who the user is, limited to the granted scopes. Taken while the
 * user sits on the consent page, because that is the one moment we are sure
 * to hold a live LernSax session for them — `/oauth/userinfo` later only
 * replays it. Group membership therefore reflects the time of login, which is
 * what a relying party wants to key its own session on anyway.
 */
export function buildClaims(client: LernSaxClient, user_id: string, scopes: string[]): IdentityClaims | undefined {
  if (!scopes.includes("openid")) return undefined;
  const me = client.whoami();
  const groups = client.groups();
  const claims: IdentityClaims = { sub: user_id };
  if (scopes.includes("profile")) claims.name = me?.fullname || me?.name_hr || undefined;
  if (scopes.includes("email")) claims.email = me?.email ?? me?.login ?? undefined;
  if (scopes.includes("school")) {
    // 16 = Schule, 19 = Klasse — the same codes the sidebar's scope filter uses.
    claims.schools = groupsOfType(groups, 16);
    claims.classes = groupsOfType(groups, 19);
  }
  return claims;
}
