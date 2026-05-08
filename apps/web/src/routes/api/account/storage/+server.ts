import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { listForUser } from "$lib/server/connectionStore";
import { getUserIdForSession, listSessionsForUser } from "$lib/server/sessionStore";

const COOKIE = "lernsax_sid";

/**
 * Bestandsaufnahme dessen, was der Server für die anrufende Person
 * speichert. Anmeldedaten werden hier *nicht* zurückgegeben — dafür gibt
 * es /api/account/export.
 *
 * Identität ist der LernSax-Account (per Email-Hash). Pro Gerät existiert
 * eine eigene Sitzung, alle MCP-Verbindungen sind aber dem Account zugeordnet
 * und damit geräteübergreifend sichtbar.
 */
export const GET: RequestHandler = async ({ cookies }) => {
  const sid = cookies.get(COOKIE);
  const user_id = getUserIdForSession(sid ?? null);
  const connections = user_id ? listForUser(user_id).map((c) => ({
    id: c.id,
    client_name: c.client_name,
    scopes: c.scopes,
    created_at: c.created_at,
    last_used_at: c.last_used_at,
  })) : [];
  const deviceSessions = user_id ? listSessionsForUser(user_id, sid) : [];

  return json({
    session: {
      present: !!sid,
      ttl_days: 365,
      cookie: { name: COOKIE, http_only: true, secure: true, same_site: "Lax" },
      stored: [
        "AES-256-GCM-verschlüsselte LernSax-Anmeldedaten",
        "Account-Kennung (SHA-256 der Email, gekürzt)",
        "Erstellt- und Letzter-Zugriff-Zeitstempel",
        "IP bei Anmeldung und zuletzt gesehene IP",
        "User-Agent",
      ],
    },
    account: {
      // user_id wird aus dem Email-Hash abgeleitet — derselbe LernSax-Account
      // ergibt auf jedem Gerät dieselbe ID, ohne dass die Email auf der Platte
      // im Klartext steht.
      user_id: user_id ?? null,
      devices: {
        count: deviceSessions.length,
        records: deviceSessions.map((d) => ({
          device_id: d.device_id,
          current: d.isCurrent,
          createdAt: d.createdAt,
          lastSeen: d.lastSeen,
          firstIp: d.firstIp ?? null,
          lastIp: d.lastIp ?? null,
          userAgent: d.userAgent ?? null,
        })),
      },
    },
    connections: {
      count: connections.length,
      ttl_days: null,
      stored: [
        "SHA-256-Hash von Access- und Refresh-Token (Klartext-Tokens werden nie gespeichert)",
        "Account-Kennung (verknüpft die Verbindung mit deinem LernSax-Account, geräteübergreifend)",
        "Client-Name und Client-ID",
        "Erlaubte Redirect-URIs",
        "Berechtigungen (Scopes)",
        "Erstellt-, Letzte-Nutzung- und Ablauf-Zeitstempel",
      ],
      records: connections,
      scope: "pro LernSax-Account (geräteübergreifend)",
    },
    cache: {
      contacts: { ttl_seconds: 60, scope: "im Arbeitsspeicher, pro Benutzer", stored: ["Login", "Anzeigename", "Online-Flag", "Gruppen"] },
      files_list: { ttl_seconds: 60, scope: "im Arbeitsspeicher, pro Gruppe", stored: ["Datei- und Ordner-Auflistung"] },
      lernsax_session: { ttl_minutes: "≈30 (LernSax-seitig); proaktiver Reload nach 4 min Idle", scope: "im Arbeitsspeicher, Client-Objekt", stored: ["LernSax-Session-ID", "Profil (whoami)", "Gruppenmitgliedschaften"] },
    },
    not_stored: [
      "Mail-Inhalte, Anhänge, Dateien, Kalender-Einträge, Aufgaben (werden bei jeder Anfrage live von LernSax geholt)",
      "Browser-Einstellungen (Theme, Navigations-Layout) — die liegen im localStorage deines Browsers, nicht auf dem Server",
    ],
  });
};
