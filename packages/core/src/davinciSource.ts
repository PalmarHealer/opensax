/**
 * Figures out *which kind* of DaVinci publication an endpoint is.
 *
 * Schools hand out one of two things and rarely say which: a live InfoServer
 * (`daVinciIS.dll`, JSON, sometimes behind a login) or a generated static HTML
 * export. Rather than making the user classify their own URL, we probe once
 * when the connection is saved and remember the answer — including the URL
 * that actually answered, so later reads skip the guessing entirely.
 */
import {
  describeDaVinci,
  fetchDaVinci,
  type DaVinciConnectionInfo,
  type DaVinciCredentials,
} from "./davinci.js";
import { fetchDaVinciHtml } from "./davinciHtml.js";

export type DaVinciSourceKind = "infoserver" | "html";

export interface DaVinciSourceProbe {
  kind: DaVinciSourceKind;
  /** The URL that answered — an InfoServer entry point or an index page. */
  resolvedEndpoint: string;
  info: DaVinciConnectionInfo;
}

/**
 * Probe an endpoint, InfoServer first.
 *
 * The InfoServer is tried first because it is the richer source and its
 * failure modes are specific (a rejected password is a definitive answer, not
 * a reason to go looking for HTML). Only a transport-level or shape mismatch
 * falls through to the HTML reader.
 */
export async function probeDaVinciSource(
  cfg: DaVinciCredentials,
): Promise<{ ok: true; probe: DaVinciSourceProbe } | { ok: false; error: string }> {
  let jsonError: string;
  try {
    const { payload, resolvedEndpoint } = await fetchDaVinci({ ...cfg });
    if (payload) {
      return {
        ok: true,
        probe: { kind: "infoserver", resolvedEndpoint, info: describeDaVinci(payload) },
      };
    }
    jsonError = "Server lieferte keine Daten";
  } catch (e) {
    jsonError = (e as Error).message;
    // Credentials were understood and refused — that is an InfoServer telling
    // us something true. Reporting it beats a confusing HTML-parse failure.
    if (/abgelehnt/i.test(jsonError)) return { ok: false, error: jsonError };
  }

  try {
    const html = await fetchDaVinciHtml({ endpoint: cfg.endpoint });
    return {
      ok: true,
      probe: {
        kind: "html",
        resolvedEndpoint: html.resolvedEndpoint,
        info: {
          scheduleDescription: "Vertretungsplan (HTML-Export)",
          validFrom: html.dates[0]?.replace(/-/g, ""),
          validTo: html.dates[html.dates.length - 1]?.replace(/-/g, ""),
          profile: "html",
          lessonCount: html.entries.length,
          classCount: new Set(html.entries.flatMap((e) => e.classes)).size,
          teacherCount: new Set(html.entries.flatMap((e) => e.teachers)).size,
          serverVersion: html.generatedAt ? `Export ${html.generatedAt}` : undefined,
        },
      },
    };
  } catch (htmlError) {
    // Neither shape fit. The JSON attempt is the more informative of the two
    // for a mistyped host, so lead with it.
    return { ok: false, error: `${jsonError} · HTML-Export: ${(htmlError as Error).message}` };
  }
}
