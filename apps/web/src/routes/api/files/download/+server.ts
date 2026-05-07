import { redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

/**
 * Compatibility shim — funnels into the proxying /view endpoint with
 * `download=1` so the browser actually saves the file instead of trying to
 * render it inline (PDFs/images otherwise just open in a new tab).
 */
export const GET: RequestHandler = async ({ url }) => {
  const params = new URLSearchParams(url.searchParams);
  params.set("download", "1");
  throw redirect(302, `/api/files/view?${params.toString()}`);
};
