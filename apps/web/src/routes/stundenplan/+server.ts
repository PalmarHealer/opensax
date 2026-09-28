import { redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

/**
 * The timetable used to live at `/stundenplan` while every other section was
 * English. Bookmarks and the home-screen shortcuts people already made keep
 * pointing here, so the old path stays as a permanent redirect rather than a
 * 404.
 */
export const GET: RequestHandler = ({ url }) => {
  redirect(308, `/timetable${url.search}`);
};
