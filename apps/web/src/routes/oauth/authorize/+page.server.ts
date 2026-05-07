import { error, fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { findClient, issueAuthCode } from "$lib/server/connectionStore";

interface AuthRequest {
  client_id: string;
  redirect_uri: string;
  state?: string;
  scope?: string;
  code_challenge?: string;
  code_challenge_method?: string;
}

function parseFromParams(p: URLSearchParams | FormData): AuthRequest | null {
  const get = (k: string) => {
    const v = p.get(k);
    return typeof v === "string" ? v : null;
  };
  const client_id = get("client_id");
  const redirect_uri = get("redirect_uri");
  const response_type = get("response_type") ?? "code";
  if (!client_id || !redirect_uri || response_type !== "code") return null;
  return {
    client_id,
    redirect_uri,
    state: get("state") ?? undefined,
    scope: get("scope") ?? undefined,
    code_challenge: get("code_challenge") ?? undefined,
    code_challenge_method: get("code_challenge_method") ?? undefined,
  };
}
function parse(url: URL): AuthRequest | null {
  return parseFromParams(url.searchParams);
}

export const load: PageServerLoad = async ({ locals, url, cookies }) => {
  const req = parse(url);
  if (!req) throw error(400, "Missing or invalid authorization parameters");

  const client = findClient(req.client_id);
  if (!client) throw error(400, "Unknown client_id");
  if (!client.redirect_uris.includes(req.redirect_uri)) {
    throw error(400, "redirect_uri does not match registered URIs");
  }

  // Require the user to be logged into our app first. If not, bounce to /login
  // with `next` pointing back to this URL — after login they land here again.
  if (!locals.client) {
    throw redirect(303, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  }

  return {
    client_name: client.client_name,
    client_id: client.client_id,
    scopes: (req.scope ?? "lernsax").split(/\s+/),
    user: {
      displayName: locals.client.whoami()?.fullname ?? locals.client.whoami()?.email ?? "",
      email: locals.client.whoami()?.email ?? locals.client.whoami()?.login ?? "",
    },
    // Echo all parameters so the form can re-submit them.
    raw: Object.fromEntries(url.searchParams.entries()) as Record<string, string>,
  };
};

export const actions: Actions = {
  approve: async ({ request, cookies }) => {
    const sid = cookies.get("lernsax_sid");
    if (!sid) return fail(401, { error: "not authenticated" });

    // The action URL drops the original query string (it becomes `?/approve`),
    // so the OAuth params travel via hidden form inputs instead.
    const data = await request.formData();
    const req = parseFromParams(data);
    if (!req) return fail(400, { error: "invalid request" });
    const client = findClient(req.client_id);
    if (!client) return fail(400, { error: "unknown client" });
    if (!client.redirect_uris.includes(req.redirect_uri)) return fail(400, { error: "bad redirect_uri" });

    const code = issueAuthCode({
      client_id: req.client_id,
      user_sid: sid,
      redirect_uri: req.redirect_uri,
      scopes: (req.scope ?? "lernsax").split(/\s+/),
      code_challenge: req.code_challenge,
      code_challenge_method: req.code_challenge_method,
    });

    const u = new URL(req.redirect_uri);
    u.searchParams.set("code", code);
    if (req.state) u.searchParams.set("state", req.state);
    throw redirect(303, u.toString());
  },
  deny: async ({ request }) => {
    const data = await request.formData();
    const req = parseFromParams(data);
    if (!req) return fail(400, { error: "invalid request" });
    const u = new URL(req.redirect_uri);
    u.searchParams.set("error", "access_denied");
    if (req.state) u.searchParams.set("state", req.state);
    throw redirect(303, u.toString());
  },
};
