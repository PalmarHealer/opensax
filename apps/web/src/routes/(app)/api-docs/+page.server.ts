import type { PageServerLoad } from "./$types";
import { fetchApiSpec } from "$lib/server/mcpInternal";

export const load: PageServerLoad = async () => {
  return { spec: await fetchApiSpec() };
};
