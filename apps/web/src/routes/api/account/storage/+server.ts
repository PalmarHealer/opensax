import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { listForUser } from "$lib/server/connectionStore";
import { getUserIdForSession, listSessionsForUser } from "$lib/server/sessionStore";
import { loadConfig as loadDavinciConfig } from "$lib/server/davinciStore";

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
    kind: c.kind ?? "oauth",
    client_name: c.client_name,
    scopes: c.scopes,
    created_at: c.created_at,
    last_used_at: c.last_used_at,
    expires_at: c.expires_at,
    has_identity_snapshot: !!c.claims,
  })) : [];
  const deviceSessions = user_id ? listSessionsForUser(user_id, sid) : [];
  // Passwort bleibt draußen — dafür gibt es /api/account/export.
  const davinci = user_id ? loadDavinciConfig(user_id) : null;

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
      tokens: connections.filter((c) => c.kind === "token").length,
      // OAuth connections live until revoked; API tokens until the expiry the
      // user picked (or revoked). No fixed server-side TTL either way.
      ttl_days: null,
      stored: [
        "SHA-256-Hash von Access- und Refresh-Token bzw. API-Token (Klartext-Tokens werden nie gespeichert)",
        "Account-Kennung (verknüpft die Verbindung mit deinem LernSax-Account, geräteübergreifend)",
        "Art (OAuth-Verbindung oder API-Token), Client-Name bzw. selbst vergebener Token-Name, Client-ID",
        "Erlaubte Redirect-URIs (nur OAuth)",
        "Berechtigungen (Scopes) — bei API-Tokens die Liste der erlaubten Tools",
        "Erstellt-, Letzte-Nutzung- und Ablauf-Zeitstempel",
        "Nur bei „Anmelden mit OpenSax“ (Scope openid): Identitäts-Snapshot vom Zeitpunkt der Zustimmung — Name, Email, Schule(n), Klasse(n) —, den die App über /oauth/userinfo abruft",
      ],
      note: "API-Tokens und MCP-Verbindungen haben keine eigenen Anmeldedaten: Sie nutzen die verschlüsselt gespeicherte Anmeldung deiner Geräte-Sitzungen. Sind alle Geräte abgemeldet, funktionieren sie nicht mehr.",
      records: connections,
      scope: "pro LernSax-Account (geräteübergreifend)",
    },
    davinci: {
      present: !!davinci,
      scope: "pro LernSax-Account (geräteübergreifend)",
      stored: [
        "AES-256-GCM-verschlüsselte Zugangsdaten des Stundenplan-Servers deiner Schule",
        "Endpoint wie eingegeben, plus die beim Test aufgelöste URL und die erkannte Quellenart",
        "Optionale Filter: Klasse, Lehrer-Kürzel, Aufsichten anzeigen",
      ],
      record: davinci
        ? {
            endpoint: davinci.endpoint,
            resolved_endpoint: davinci.resolvedEndpoint ?? null,
            source_type: davinci.sourceType ?? null,
            username: davinci.username,
            has_password: !!davinci.password,
            class_code: davinci.classCode ?? null,
            teacher_code: davinci.teacherCode ?? null,
            include_supervisions: davinci.includeSupervisions ?? false,
          }
        : null,
    },
    // Funktionale Cookies, die der Browser selbst setzt — hier nur zur
    // Transparenz aufgeführt, der Server liest sie lediglich beim Rendern.
    browser: {
      scope: "nur im Browser, nichts davon landet auf dem Server",
      cookies: [
        {
          name: "lernsax_group",
          purpose: "Zuletzt geöffnete Gruppe bzw. Raum, damit der Bereich beim Wechsel zwischen Wiki, Dateien, Mitteilungen usw. erhalten bleibt",
          value: "Gruppen-Kennung oder leer für „Persönlich“",
          ttl_days: 365,
        },
        {
          name: "lernsax_theme",
          purpose: "Hell/Dunkel, damit serverseitig gerenderte Ansichten im richtigen Design starten",
          value: "„light“ oder „dark“",
          ttl_days: 365,
        },
      ],
      local_storage: ["Navigations-Layout und Reihenfolge der Tabs", "Theme-Einstellung"],
    },
    cache: {
      contacts: { ttl_seconds: 60, scope: "im Arbeitsspeicher, pro Benutzer", stored: ["Login", "Anzeigename", "Online-Flag", "Gruppen"] },
      davinci_dataset: { ttl_minutes: 5, scope: "im Arbeitsspeicher, pro Benutzer", stored: ["Stundenplan-Datensatz der Schule", "eTag des Servers"] },
      files_list: { ttl_seconds: 60, scope: "im Arbeitsspeicher, pro Gruppe", stored: ["Datei- und Ordner-Auflistung"] },
      lernsax_session: { ttl_minutes: "≈30 (LernSax-seitig); proaktiver Reload nach 4 min Idle", scope: "im Arbeitsspeicher, Client-Objekt", stored: ["LernSax-Session-ID", "Profil (whoami)", "Gruppenmitgliedschaften"] },
      mcp_api_session: { ttl_minutes: 5, scope: "im Arbeitsspeicher des MCP-/API-Servers, pro Account, verfällt 5 min nach dem letzten Aufruf", stored: ["LernSax-Session-ID", "Profil (whoami)", "Gruppenmitgliedschaften"] },
      rate_limit: { ttl_minutes: 60, scope: "im Arbeitsspeicher, zum Schutz vor Missbrauch", stored: ["IP-Adresse und ggf. Login-Email bei Anmelde- und OAuth-Versuchen", "Hash des API-Tokens bei API-Aufrufen", "Zeitpunkte der Anfragen"] },
    },
    // Nur was jemand selbst über „Feedback / Fehler melden“ abschickt.
    feedback: {
      scope: "nur wenn du selbst eine Meldung abschickst, nicht mit deinem Account verknüpft",
      stored: [
        "Deine Antworten im Feedback-Wizard",
        "Nur wenn angekreuzt: Screenshot, Browser-Logs, technische Infos ohne Namen, Account-Daten (Name, Login, Schule, Klassen)",
        "Nur wenn gewählt: Kontaktweg (LernSax-Mail oder selbst eingegebene Mail/Telefonnummer)",
        "Wird an das Feedback-System der Betreiber weitergeleitet; nur wenn keins eingerichtet ist, bleibt die Meldung auf diesem Server",
      ],
    },
    // Nicht bei uns, aber auf demselben Server: der Dokumentserver fürs
    // Bearbeiten im Browser. Er bekommt die Datei, solange sie offen ist.
    office: {
      scope: "Office-Dokumentserver (Euro-Office), nur beim Bearbeiten einer Datei im Browser",
      stored: [
        "Arbeitskopie der geöffneten Datei, solange sie bearbeitet wird; beim Speichern landet sie wieder in LernSax",
        "Der Dokumentserver räumt diese Kopien selbst auf (Standard: spätestens nach einem Tag)",
      ],
    },
    not_stored: [
      "Mail-Inhalte, Anhänge, Dateien, Kalender-Einträge, Aufgaben (werden bei jeder Anfrage live von LernSax geholt — Ausnahme: die Arbeitskopie beim Bearbeiten im Office-Editor, s.o.)",
      "Inhalte von API- und MCP-Aufrufen (Argumente und Antworten werden durchgereicht, nicht protokolliert)",
      "Browser-Einstellungen (Theme, Navigations-Layout, zuletzt geöffnete Gruppe) — die liegen im localStorage bzw. in funktionalen Cookies deines Browsers, nicht auf dem Server",
    ],
  });
};
