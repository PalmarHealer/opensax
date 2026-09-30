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
| **Aufgaben** | CRUD mit Fälligkeitsdatum, gated by `tasks_write`-Right pro Gruppe · **Beschreibung** aufklappbar (sanitized HTML) · Aufgaben der Klasse, die nicht dir zugewiesen sind, sind ausgeblendet und per Auge einblendbar (`nicht zugewiesen`-Badge) — im Dashboard tauchen sie nie auf |
| **Kalender** | Monatsansicht mit Wochenraster (Mo–So), Ferien aus `get_superiors` als Badges, Multi-Day-Events fanen aus, Termine erstellen via Tag-Klick |
| **Mitteilungen** | Pro Gruppe + Kind-Switch (Allgemein/Lehrer/Schüler), HTML-Render mit Sanitize, 8 LernSax-Farben als Akzent-Streifen, Author + Datum |
| **Notizen** | Kartengrid mit 6 Farben, Inline-Edit |
| **Chat** | Discord-Style Bubbles · Konversationsliste mit Last-Message-Preview · Neuer Chat aus Gruppen-Mitgliedern (Online-Indikator + Suche) oder manueller Email · Aktiver Chat in URL `?with=` |
| **Dateien** | Drive-Browser mit Drag&Drop-Upload · Quota-Bar · Click-anywhere auf Zeile · **Inline-Preview** für PDF/Bild/Text via Server-Proxy (kein Fullscreen) · Datei erscheint als "Sub-Ordner" im Breadcrumb · **Breadcrumb-Trenner aufklappbar** — jeder Pfeil zeigt die Ordner auf der Ebene der Krume dahinter (beim Datei-Pfeil: die Dateien im Ordner), Seitwärtswechsel in einem Klick · Forced-Save-Download · Mkdir/Rename/Delete |
| **Stundenplan** | Wochenraster aus **DaVinci** (nicht LernSax) — Zeilen sind Stundenblöcke, dieselbe Stunde liegt über alle Tage auf gleicher Höhe · Vertretungen, Entfall und Verlegungen farbig markiert, geteilte Klassen nebeneinander · Auto-Filter auf die eigene Klasse bzw. Lehrkraft · **Zeitbezug live**: die laufende Stunde zeigt ihre Restzeit („noch 23 min"), in Pausen und vor Schulbeginn kündigt sich stattdessen die nächste an („in 15 min", höchstens eine Stunde im Voraus) — beides aus der Browser-Uhr im 30-s-Takt, nicht vom Server · am Wochenende öffnet die **kommende** Woche statt der abgelaufenen · mobil dieselbe Anordnung als Tagesliste · Zugang pro Nutzer, verschlüsselt in Settings hinterlegt · auch über MCP abrufbar |
| **Settings** | Tab-Rail mit URL-State `?tab=` · Profil mit allen LernSax-Feldern · Mail-Signatur · **Stundenplan-Zugang** (Endpoint/Login mit Verbindungstest) · **Layout-Picker** (Sidenav vs. Topnav) · **Drag&Drop Tab-Reordering** mit Live-Shift, Drop-into-Hidden-Zone |

### Stundenplan-Datenquellen

DaVinci wird auf zwei Arten publiziert, und Schulen sagen selten welche. OpenSax
probt beim Speichern einmal und merkt sich das Ergebnis:

| Quelle | Erkennung | Was drin ist |
|---|---|---|
| **InfoServer** (`daVinciIS.dll`) | JSON-Antwort mit `about`/`result` | Vollständiger Plan **und** Vertretungen; Login bindet die Ansicht automatisch an Klasse oder Lehrkraft |
| **HTML-Export** | Generierte Seiten mit Monatsindex + Tagestabellen | Nur Abweichungen, kein Login, keine Uhrzeiten (nur Stundennummern) — Klasse muss in Settings gesetzt werden |

Protokoll-Eigenheiten, die in keiner Doku stehen:

- Das Passwort geht als `key`, ungesalzenes MD5. InfoServer-Builds um 6.5.77
  lehnen das Klartextfeld mit **HTTP 910** ab.
- Auth-Fehler kommen als **9xx**-Status statt 401.
- Benutzernamen haben signifikante Leerzeichen (`"IT 25/3 "`) und dürfen nicht
  getrimmt werden.
- Ein Endpoint ohne Schema wird erst über HTTPS, dann HTTP versucht — die
  meisten Schulserver sprechen nur HTTP. Mit `https://` davor bleibt es dabei.
  Die URL, die geantwortet hat, wird gespeichert, damit spätere Aufrufe nicht
  den toten Versuch mitzahlen.

### Layout-Modi

- **Sidenav** (default): schmale 64px-Rail links mit Icons, Avatar unten
- **Topnav**: horizontale Bar mit Icon+Label-Pillen, Avatar oben rechts

Responsive rein über CSS-Breakpoints, ohne JS-Viewport-Store: mobil (< `md`)
Bottom-Tabs und Drill-down, ab `md` die Mehrspalten-Ansichten, ab `xl`
zusätzlich die 240px-Seitenleisten. Ein JS-Store müsste beim SSR raten und
würde bei Fehlbedienung die Hydration mitreißen.

Wo eine Ansicht auf dem Handy nicht bloß enger, sondern *anders* sein muss,
stehen beide Varianten im Markup und werden per CSS umgeschaltet — Stundenplan
(Tagesliste statt Wochenraster), Kalender (Monatswähler mit Punkten plus
Tagesagenda statt 6×7-Raster mit Titeln), Dateien (Name mit Datum/Größe als
zweite Zeile statt fünf Spalten).

### Mobile Navigation

Die Tab-Leiste unten trägt bis zu fünf Apps in der vom Nutzer konfigurierten
Reihenfolge; der letzte Platz gehört dem **Avatar**, nicht einem „Mehr"-Menü.
Er öffnet dasselbe Profil-Popup wie am Desktop, dort aber zusätzlich mit

- **Gruppen / Räume**, sofern die Route überhaupt in einer Gruppe arbeitet —
  auf dem Handy gibt es keine Seitenleiste, die das sonst trüge, und
- **Apps**, das die Schublade mit der vollständigen App-Liste aufzieht.

Einstellungen sind aus der App-Schublade und der Tab-Leiste ausgeblendet: der
Eintrag steht im Profil-Popup, das immer eine Berührung entfernt ist. Zweimal
dasselbe Ziel nebeneinander wäre kein zusätzlicher Weg, nur eine zusätzliche
Entscheidung.

Die Schublade schließt bei jedem Griff daneben. Der Backdrop allein reicht
dafür nicht — die Tab-Leiste liegt auf derselben z-Ebene und steht im DOM
danach, fängt Klicks also ab; ein `pointerdown`-Listener am Dokument erwischt
Leiste, Avatar und Backdrop gleichermaßen.

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
| `/files` | Persönlich + Schule + Klassen |
| `/mail`, `/notes`, `/messenger`, `/timetable`, `/settings` | versteckt |

Die zuletzt gewählte Gruppe landet im Cookie `lernsax_group` und wird
bereichsübergreifend wieder eingesetzt — von Wiki zu Dateien bleibt man im
selben Raum. Der Server schreibt sie im Layout-Load zurück in die URL (`?group=`),
weil die Gruppe dort lebt und der Redirect vor jedem Client-Code passieren muss.
Ein leerer Cookie ist eine echte Antwort („Persönlich") und wird nicht
überschrieben; eine Gruppe, die nicht mehr existiert oder zu den Scopes der
Route nicht passt, wird ignoriert statt in eine leere Ansicht zu führen.

### Anmelden mit OpenSax

Andere Apps können OpenSax als Login nutzen (OAuth 2.1 Authorization Code +
PKCE, dazu ein schlanker OIDC-Teil). Die Scopes `openid`, `profile`, `email`
und `school` geben nur Identität heraus — Name, LernSax-Adresse, Schulen
(Gruppentyp 16) und Klassen (19). `GET /oauth/userinfo` mit dem Access-Token
liefert:

```json
{ "sub": "…", "name": "Vorname Nachname",
  "schools": [{ "id": "schule@…", "name": "…" }],
  "classes": [{ "id": "klasse@…", "name": "…" }] }
```

`sub` ist dieselbe `user_id` wie überall sonst in OpenSax. Die Angaben sind
ein Schnappschuss vom Moment der Zustimmung; der Token lebt zehn Minuten,
hat keinen Refresh-Token und ersetzt den vorherigen derselben App. Der
MCP-Server nimmt ihn nicht an — nur ein `lernsax`-Grant steuert das Konto.

Vertrauliche Clients (mit Secret, optional ohne Zustimmungsdialog) trägt der
Betreiber in `OPENSAX_OAUTH_CLIENTS` ein, siehe `.env.example`. Über
`/oauth/register` angelegte Clients bleiben öffentlich und brauchen PKCE.

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
- `LERNSAX_API_HTTP_PATH` (`/api/v1`) — REST-API, siehe unten
- `LERNSAX_API_RATE_PER_MIN` (`120`)

### Verfügbare Tools

`whoami`, `groups_list`, `mail_*` (folders/list/read/send/save_draft/flag/move/delete), `tasks_*`, `calendar_*` (+ `calendar_holidays`), `board_*`, `notes_*`, `chat_*`, `files_*`, `notifications_*`, `profile_get`, `addresses_list`, `forum_*`, `wiki_*`, `members_*`, `resources_*`, `timetable_*`, plus `raw_call` als Escape-Hatch.

#### Stundenplan über MCP

`timetable_info` und `timetable_get` (Default: laufende Woche — am Wochenende
die kommende, dieselbe Regel wie in der Weboberfläche; dazu `from`/`to`,
`class_code`, `teacher_code`, `room_code`, `changes_only`) lesen **denselben**
DaVinci-Zugang, den die Weboberfläche unter Settings → Stundenplan gespeichert
hat — ein Chat-Client kann die InfoServer-URL einer Schule schließlich nicht
kennen. Der MCP-Container entschlüsselt die Konfiguration aus
`/app/data/davinci` mit dem gemeinsamen `LERNSAX_WEB_SESSION_KEY`, genau wie er
es schon für die Sessions tut. Die Kennung ist derselbe `user_id`
(SHA-256 der Email, gekürzt), also treffen OAuth-Bearer und stdio-Aufruf mit
`email`/`password` auf dieselbe Konfiguration. Ohne hinterlegten Zugang
antworten beide Tools mit einem Hinweis auf die Einrichtung statt mit einem
leeren Plan.

## REST-API (`/api/v1`)

Dieselben Tools wie der MCP-Server, als HTTP-API: `POST /api/v1/<tool>` mit den
Argumenten als JSON-Body, `Authorization: Bearer <token>`. Die Tools sind in
`packages/mcp/src/tools.ts` einmal definiert; MCP-Server, REST-Endpunkte und
die OpenAPI-Beschreibung (`GET /api/v1/openapi.json`, öffentlich) werden daraus
erzeugt. Die Doku für Menschen liegt in der App unter `/api-docs`.

**Tokens** erstellt man unter Einstellungen → Verbindungen: Name, Ablauf (Tage,
Datum oder nie) und die erlaubten Tools — **jedes Tool ist ein eigener Scope**.
Das Token wird einmal angezeigt (Präfix `osx_`), gespeichert wird nur sein
SHA-256 in `/app/data/connections`, neben den OAuth-Verbindungen. Eigene
Anmeldedaten hat es nicht: wie der MCP-Connector nutzt es die verschlüsselte
Anmeldung der Geräte-Sitzungen und funktioniert, solange der Account auf
mindestens einem Gerät angemeldet ist. API-Tokens funktionieren auch am
MCP-Endpoint; dort sieht der Client nur die freigegebenen Tools. Der Scope
`lernsax` (MCP-Connector) steht für alle Tools.

- `GET /api/v1/tools` — freigegebene Tools und Ablauf des vorgelegten Tokens
- Fehler immer als `{ "error": { "code", "message", "details?" } }`
- 120 Anfragen pro Minute und Token (`LERNSAX_API_RATE_PER_MIN`)
- `files_download` liefert die Datei selbst statt Base64

Ausgeliefert wird die API vom MCP-Container; die Web-App reicht `/api/v1/*`
an `LERNSAX_MCP_INTERNAL_URL` (Default `http://lernsax-mcp:8765`) weiter, eine
Änderung am Reverse-Proxy ist also nicht nötig.

## Core-Library (`packages/core`)

Stateless TypeScript-Wrapper:

- `LernSaxClient` — One-Stop-Facade mit allen API-Namespaces (mail, tasks, calendar, board, notes, messenger, files, profile, addresses, forum, wiki, members, resources, notifications)
- `LernSaxSession` — JSON-RPC-Transport mit Batch + Auto-Reload + Re-Login bei Session-Expiry
- `WebDavClient` — Basic-Auth WebDAV für große Dateien
- `SessionCache` — TTL-Pool für den MCP-Server
- `fetchDaVinci` / `expandDaVinciDays` — DaVinci-InfoServer: JSON holen und die
  Unterrichts*serien* (eine Zeile trägt alle ihre Termine) zu Tageseinträgen
  auffalten, Vertretungen eingerechnet
- `fetchDaVinciHtml` — der statische HTML-Export als zweite Quelle
- `probeDaVinciSource` — erkennt, welche der beiden ein Endpoint ist
- Hilfsfunktionen: `buildFileTree`, `buildFileBreadcrumb`, `groupHasRight`, `userDisplay`, `mailPartyDisplay`, `notificationDate`

## Sicherheit

- Credentials nur im Server-RAM, AES-256-GCM verschlüsselt
- Session-Cookies HTTP-only, SameSite=Lax, im Prod-Build `Secure`
- Mail-HTML wird durch einen kleinen Sanitizer geschickt (Scripts/iframes/Event-Handler raus, alle Links auf `target="_blank"`)
- Datei-Proxy strippt `X-Frame-Options`/CSP nur für unsere eigene Response, das LernSax-CDN bleibt unberührt
- MCP-HTTP optional mit Bearer-Token-Auth
- API-Tokens nur als Hash gespeichert, pro Tool freigegeben, mit selbst gewähltem Ablauf; „Alle Daten löschen“ entfernt sie mit

## Status

Im Wesentlichen feature-complete für den Single-User-Self-Hosting-Use-Case.
Offen:
- **Wiki schreiben und auflisten** — die dokumentierte API kennt für das
  `wiki`-Objekt nur `get_page`. `get_entries`/`add_entry`/`set_entry` gibt es
  dort nicht, der Server antwortet mit `Unknown command`. Die Seite kann
  deshalb weder Seiten auflisten noch anlegen; das ist keine Lücke im Code,
  sondern eine in der API.
- **Forum-Beiträge löschen** braucht `forum_admin`; mit `forum_write` kann man
  posten, aber nichts zurücknehmen.
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
