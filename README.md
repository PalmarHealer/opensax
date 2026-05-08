# OpenSax

Modernes Webinterface + lokaler MCP-Server für die LernSax/WebWeaver-API.
Beide nutzen denselben TypeScript-Wrapper (`@lernsax/core`).

## Layout

```
packages/
  core/   ← API-Wrapper: JSON-RPC, Session, WebDAV, alle API-Objekte
  mcp/    ← MCP-Server (stdio + Streamable-HTTP). Credentials kommen pro Tool-Call rein, Sessions werden gecached.
apps/
  web/    ← SvelteKit-App im Discord/Drive-Stil. Login-Form → verschlüsselter Server-Session-Store.
```

## Quick start

### Lokal entwickeln

```bash
pnpm install
pnpm --filter @lernsax/core build
pnpm dev:web      # SvelteKit auf http://localhost:5173
pnpm dev:mcp      # MCP via stdio (für Claude Desktop / Code)
```

### Container

```bash
docker compose -f docker-compose.local.yml up -d --build
```

- Web: http://localhost:3001
- MCP (Streamable-HTTP): http://localhost:8765/mcp

## Web-App (`apps/web`)

Login auf `/login`, danach landet die Session in einem HTTP-only Cookie (30 Tage).
Credentials liegen im Server-RAM mit AES-256-GCM verschlüsselt — der Cookie hält nur eine Session-ID.

`apps/web/.env`:
```
LERNSAX_WEB_SESSION_KEY=<32+ char secret>
```

### Features

| Bereich | UI |
|---|---|
| **Übersicht** | Begrüßung, anstehende Termine (über alle Gruppen), ungelesene Mails, offene Aufgaben, System-Notifications |
| **Mail** | Folder-Rail + Liste + Detail in 3 Spalten · Bulk-Select mit Checkboxen, Bulk-Delete, Bulk-Mark-Read · Antworten / Allen / Weiterleiten / Löschen · Compose als minimierbares Floating-Window · Anhänge mit Server-Proxy & forced-Save · Auto-Linkify im Plaintext, sanitized HTML · Folder-CRUD mit Vorhaltezeit · Signatur-Editor in Settings |
| **Aufgaben** | CRUD mit Fälligkeitsdatum, gated by `tasks_write`-Right pro Gruppe |
| **Kalender** | Monatsansicht mit Wochenraster (Mo–So), Ferien aus `get_superiors` als Badges, Multi-Day-Events fanen aus, Termine erstellen via Tag-Klick |
| **Mitteilungen** | Pro Gruppe + Kind-Switch (Allgemein/Lehrer/Schüler), HTML-Render mit Sanitize, 8 LernSax-Farben als Akzent-Streifen, Author + Datum |
| **Notizen** | Kartengrid mit 6 Farben, Inline-Edit |
| **Chat** | Discord-Style Bubbles · Konversationsliste mit Last-Message-Preview · Neuer Chat aus Gruppen-Mitgliedern (Online-Indikator + Suche) oder manueller Email · Aktiver Chat in URL `?with=` |
| **Dateien** | Drive-Browser mit Drag&Drop-Upload · Quota-Bar · Click-anywhere auf Zeile · **Inline-Preview** für PDF/Bild/Text via Server-Proxy (kein Fullscreen) · Datei erscheint als "Sub-Ordner" im Breadcrumb · Forced-Save-Download · Mkdir/Rename/Delete |
| **Settings** | Tab-Rail mit URL-State `?tab=` · Profil mit allen LernSax-Feldern · Mail-Signatur · **Layout-Picker** (Sidenav vs. Topnav) · **Drag&Drop Tab-Reordering** mit Live-Shift, Drop-into-Hidden-Zone |

### Layout-Modi

- **Sidenav** (default): schmale 64px-Rail links mit Icons, Avatar unten
- **Topnav**: horizontale Bar mit Icon+Label-Pillen, Avatar oben rechts

Wechsel in Settings → Navigation. Custom-Order und Sichtbarkeit der Tabs werden in `localStorage` gespeichert.

### Avatar-Menü

Rund mit Initialen (Vor- + Nachname), deterministische Hue per Login-Hash.
Klick → Popover mit Profil-Header, Einstellungen-Link, Abmelden.

### Scope-Filter

Die Gruppen-Sidebar passt sich der Route an:

| Route | Gruppen |
|---|---|
| `/` | versteckt (Dashboard ist aggregiert) |
| `/tasks`, `/calendar` | Persönlich + Klassen |
| `/board`, `/forum`, `/wiki` | Schule + Klassen |
| `/mail`, `/notes`, `/messenger`, `/settings` | versteckt |

## MCP-Server (`packages/mcp`)

Credentials werden als Tool-Argument (`email`, `password`) übergeben und intern in einem Session-Cache (5 Min Idle-TTL) gehalten.

**Zwei Transports** per `LERNSAX_MCP_TRANSPORT`:

- `stdio` (default) — lokaler Subprocess. Eintrag für Claude Desktop:
  ```json
  {
    "mcpServers": {
      "lernsax": { "command": "node", "args": ["/path/to/packages/mcp/dist/index.js"] }
    }
  }
  ```
- `streamable-http` — Container-Mode, kein lokales Install:
  ```json
  {
    "mcpServers": {
      "lernsax": {
        "url": "https://lernsax-mcp.example.com/mcp",
        "headers": { "Authorization": "Bearer <LERNSAX_MCP_AUTH_TOKEN>" }
      }
    }
  }
  ```

Env-Vars (HTTP):
- `LERNSAX_MCP_HTTP_HOST` (`0.0.0.0`)
- `LERNSAX_MCP_HTTP_PORT` (`8765`)
- `LERNSAX_MCP_HTTP_PATH` (`/mcp`)
- `LERNSAX_MCP_AUTH_TOKEN` (optional Bearer)
- `LERNSAX_MCP_IDLE_TTL_MS` (`300000`)

### Verfügbare Tools

`whoami`, `groups_list`, `mail_*` (folders/list/read/send/flag/move/delete), `tasks_*`, `calendar_*` (+ `calendar_holidays`), `board_*`, `notes_*`, `chat_*`, `files_*`, `notifications_*`, `profile_get`, `addresses_list`, `forum_*`, `wiki_page`, `members_*`, `resources_*`, plus `raw_call` als Escape-Hatch.

## Core-Library (`packages/core`)

Stateless TypeScript-Wrapper:

- `LernSaxClient` — One-Stop-Facade mit allen API-Namespaces (mail, tasks, calendar, board, notes, messenger, files, profile, addresses, forum, wiki, members, resources, notifications)
- `LernSaxSession` — JSON-RPC-Transport mit Batch + Auto-Reload + Re-Login bei Session-Expiry
- `WebDavClient` — Basic-Auth WebDAV für große Dateien
- `SessionCache` — TTL-Pool für den MCP-Server
- Hilfsfunktionen: `buildFileTree`, `buildFileBreadcrumb`, `groupHasRight`, `userDisplay`, `mailPartyDisplay`, `notificationDate`

## Sicherheit

- Credentials nur im Server-RAM, AES-256-GCM verschlüsselt
- Session-Cookies HTTP-only, SameSite=Lax, im Prod-Build `Secure`
- Mail-HTML wird durch einen kleinen Sanitizer geschickt (Scripts/iframes/Event-Handler raus, alle Links auf `target="_blank"`)
- Datei-Proxy strippt `X-Frame-Options`/CSP nur für unsere eigene Response, das LernSax-CDN bleibt unberührt
- MCP-HTTP optional mit Bearer-Token-Auth

## Status

Im Wesentlichen feature-complete für den Single-User-Self-Hosting-Use-Case.
Offen:
- **OnlyOffice-Integration** für Datei-Bearbeitung (braucht Reverse-Engineering der LernSax-OnlyOffice-Konfiguration)
- **Klassen-/Gruppen-Beitritt mit Passwort** (LernSax-API-Endpoint nicht öffentlich erreichbar)
- **Mail-Filterregeln** (gleiche Story — API nicht exposed)

## Disclaimer

OpenSax ist ein **inoffizielles, nicht-kommerzielles Open-Source-Projekt** und
steht in keinerlei Verbindung zu LernSax, der DigiOnline GmbH, dem
Landesamt für Schule und Bildung (LaSuB) oder dem Freistaat Sachsen.
Die Marke „LernSax" gehört dem jeweiligen Rechteinhaber.

OpenSax kommuniziert ausschließlich mit der vom Betreiber unter
`https://www.lernsax.de/wws/api.php` öffentlich dokumentierten WebWeaver-JSON-RPC-API
sowie dem Standard-WebDAV-Endpoint. Es findet kein Reverse Engineering statt,
keine Zugangssicherung wird umgangen — die Anmeldung erfolgt mit den
**eigenen Zugangsdaten der nutzenden Person** über das reguläre Login.

Bestimmungsgemäße Nutzung im Rahmen der LernSax-Nutzungsbedingungen
(bildungsbezogen, nicht-kommerziell, kein Massenversand) liegt in der
Verantwortung der nutzenden Person. Die Autoren übernehmen keine Gewähr
für Verfügbarkeit, Funktion oder Datenverlust.

### Hinweis zum Selbst-Hosten

Wer eine OpenSax-Instanz für andere Personen bereitstellt, wird datenschutz-
rechtlich Verantwortlicher i.S.d. Art. 4 Nr. 7 DSGVO und benötigt mindestens:

- Impressum nach § 5 DDG
- Datenschutzerklärung nach Art. 13 DSGVO
- Auftragsverarbeitungsvertrag mit dem Hoster
- dokumentierte technische und organisatorische Maßnahmen

Für die reine **Eigennutzung** (Self-Hosting für sich selbst) gelten diese
Pflichten nicht. Empfohlen wird genau dieser Modus.

## Lizenz

GPL-3.0 — siehe [`LICENSE`](LICENSE).
