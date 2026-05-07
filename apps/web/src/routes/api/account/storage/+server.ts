import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { listForUser } from "$lib/server/connectionStore";

const COOKIE = "lernsax_sid";

/**
 * Bestandsaufnahme dessen, was der Server für die anrufende Person
 * speichert. Anmeldedaten werden hier *nicht* zurückgegeben — dafür gibt
 * es /api/account/export.
 */
export const GET: RequestHandler = async ({ cookies }) => {
  const sid = cookies.get(COOKIE);
  const connections = sid ? listForUser(sid).map((c) => ({
    id: c.id,
    client_name: c.client_name,
    scopes: c.scopes,
    created_at: c.created_at,
    last_used_at: c.last_used_at,
  })) : [];

  return json({
    session: {
      present: !!sid,
      ttl_days: 30,
      cookie: { name: COOKIE, http_only: true, secure: true, same_site: "Lax" },
      stored: ["AES-256-GCM-verschlüsselte LernSax-Anmeldedaten", "Erstellt-Zeitstempel", "Letzter-Zugriff-Zeitstempel"],
    },
    connections: {
      count: connections.length,
      ttl_days: null,
      stored: ["SHA-256-Hash des Tokens (das Token selbst wird nie gespeichert)", "Client-Name", "Berechtigungen", "Zeitstempel"],
      records: connections,
    },
    cache: {
      contacts: { ttl_seconds: 60, scope: "im Arbeitsspeicher, pro Benutzer", stored: ["Login", "Anzeigename", "Online-Flag", "Gruppen"] },
      lernsax_session: { ttl_minutes: "≈30 (LernSax-seitig)", scope: "im Arbeitsspeicher, Client-Objekt", stored: ["LernSax-Session-ID"] },
    },
    not_stored: [
      "Mail-Inhalte, Anhänge, Dateien, Kalender-Einträge, Aufgaben (werden bei jeder Anfrage live von LernSax geholt)",
      "Browser-Einstellungen (Theme, Navigations-Layout) — die liegen im localStorage deines Browsers, nicht auf dem Server",
    ],
  });
};
