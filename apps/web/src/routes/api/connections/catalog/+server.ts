import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { fetchApiSpec, toolsFromSpec } from "$lib/server/mcpInternal";

/** Tools a token can be granted, for the create-token form. */
export const GET: RequestHandler = async () => {
  const spec = await fetchApiSpec();
  if (!spec) return json({ error: "API-Server nicht erreichbar." }, { status: 503 });
  return json({ tools: toolsFromSpec(spec) });
};
