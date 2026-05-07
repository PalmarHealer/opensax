import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ locals, params }) => {
  const c = locals.client!;
  const login = params.login;
  if (!login) throw error(400, "login required");
  try {
    const profile = await c.profile.get(login);
    return json({ profile });
  } catch (e) {
    throw error(404, (e as Error).message);
  }
};
