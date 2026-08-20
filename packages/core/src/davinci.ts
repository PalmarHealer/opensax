/**
 * Client for the DaVinci InfoServer (STÜBER SYSTEMS timetable software).
 *
 * Unlike LernSax there is no RPC surface here: the InfoServer (`daVinciIS.dll`,
 * an ISAPI plugin) exposes exactly one endpoint that dumps the school's entire
 * published dataset — master data, the schedule, and any substitutions — as one
 * JSON document.
 *
 *   GET|POST <host>/<path>/daVinciIS.dll?content=json[&username=…&password=…][&etag=…]
 *
 * Credentials are optional. Without them the server answers with whatever the
 * school published publicly (`user.profile` is then typically "guest" or
 * "master"); with them it identifies the caller via `user.homeType`/`homeId`,
 * which is what lets us narrow the plan down to "my lessons".
 *
 * The payload is shaped for the vendor's own web client, so it is normalised
 * rather than day-oriented: a `lessonTimes` entry is a *series* carrying every
 * date it occurs on. `expandDaVinciDays()` turns that into per-day entries with
 * codes resolved to names.
 */

// ── Wire format ────────────────────────────────────────────────────────
// Field names mirror the server's JSON exactly. Everything is optional that
// the server may omit — which, in practice, is nearly everything.

export interface DaVinciAbout {
  /** Opaque dataset version. Send it back as `etag=` to skip unchanged data. */
  eTag?: string;
  schemaVersion?: string;
  server?: string;
  serverVersion?: string;
  /** "YYYYMMDD HHMM" in school-local time. */
  serverTimeStamp?: string;
}

/** Who the server thinks we are. Present even for anonymous requests. */
export interface DaVinciUser {
  /** "guest" | "default" | "master" | "teacher" | "team" | "teammaster" */
  profile?: string;
  /** "teacher" | "class" | "student" | "room" — what `homeId` points at. */
  homeType?: string;
  /** GUID into the matching master-data array. */
  homeId?: string;
  /** Vendor-defined permission level; governs which views the app may show. */
  policy?: number;
  [k: string]: unknown;
}

/** Multi-child accounts (parents) get one entry per child. */
export interface DaVinciUserRef {
  code?: string;
  name?: string;
  homeType?: string;
  homeId?: string;
  filter?: string;
  [k: string]: unknown;
}

export interface DaVinciTeacher {
  id: string;
  /** Short code — this, not `id`, is what lessons reference. */
  code: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  teamRefs?: string[];
}

export interface DaVinciClass {
  id: string;
  code: string;
  teamRefs?: string[];
}

export interface DaVinciRoom {
  id: string;
  code: string;
  buildingRef?: string;
}

export interface DaVinciSubject {
  id: string;
  code: string;
  /** "#RRGGBB", used by the vendor client to tint the lesson tile. */
  color?: string;
  description?: string;
}

export interface DaVinciBuilding {
  id: string;
  code: string;
  description?: string;
}

export interface DaVinciAbsenceReason {
  id: string;
  code: string;
  description?: string;
  color?: string;
}

export interface DaVinciTimeslot {
  /** Period label as printed on the plan ("1", "2", …). */
  label?: string;
  /** "HHMM". */
  startTime: string;
  endTime: string;
  color?: string;
}

export interface DaVinciTimeframe {
  code?: string;
  timeslotFragmentation?: number;
  timeslots: DaVinciTimeslot[];
}

/**
 * What changed about a lesson. Absent on an untouched lesson.
 *
 * `changeType` is a vendor enum; the values we can pin down from the reference
 * client are 0 = modified, 3 = extra lesson, 4 = message only (no lesson),
 * 6/7/8 = moved. Treat anything else as "modified".
 */
export interface DaVinciChanges {
  changeType?: number;
  /**
   * Not a boolean: the server names *who* is freed ("classFree",
   * "teacherFree", …). Any non-empty value means the lesson is off.
   */
  cancelled?: string | boolean;
  /** Short code for why it was cancelled, e.g. "Ausfall". */
  cancelReasonCode?: string;
  /** Composed title the vendor client prints, e.g. "+KLL (GK)". */
  lessonTitle?: string;
  /** "YYYYMMDDHHMMSS" — when the substitution was last edited. */
  modified?: string;
  absentTeacherCodes?: string[];
  newTeacherCodes?: string[];
  absentClassCodes?: string[];
  newClassCodes?: string[];
  absentRoomCodes?: string[];
  newRoomCodes?: string[];
  newSubjectCode?: string;
  /** Set when the lesson was moved; "YYYYMMDD" / "HHMM". */
  newDate?: string;
  newStartTime?: string;
  oldDate?: string;
  oldStartTime?: string;
  /** Headline the school wants shown on the tile ("Vertretung", "Entfall", …). */
  caption?: string;
  information?: string;
  message?: string;
  reasonType?: number;
  reasonCode?: string;
  reasonDescription?: string;
}

export interface DaVinciLessonTime {
  courseTitle?: string;
  lessonRef?: string;
  courseRef?: string;
  lessonBlock?: string;
  /** Every date this lesson takes place on, "YYYYMMDD". */
  dates: string[];
  /** "HHMM". */
  startTime: string;
  endTime: string;
  subjectCode?: string;
  /** Replacement subject; sits on the lesson, not inside `changes`. */
  newSubjectCode?: string;
  classCodes?: string[];
  teacherCodes?: string[];
  roomCodes?: string[];
  buildingCodes?: string[];
  changes?: DaVinciChanges;
}

export interface DaVinciSupervisionTime {
  dates: string[];
  startTime: string;
  endTime: string;
  supervisionTitle?: string;
  supervisionRef?: string;
  /** Where the supervision takes place — the vendor client shows it as room. */
  areaCode?: string;
  teacherCodes?: string[];
  changes?: DaVinciChanges;
}

export interface DaVinciEventTime {
  dates: string[];
  startTime: string;
  endTime: string;
  eventTitle?: string;
  classCodes?: string[];
  teacherCodes?: string[];
  roomCodes?: string[];
  changes?: DaVinciChanges;
}

export interface DaVinciDisplaySchedule {
  scheduleID?: string;
  scheduleDescription?: string;
  /** School year. */
  session?: { startDate?: string; endDate?: string };
  /** The window this particular publication actually covers. */
  effectivity?: { startDate?: string; endDate?: string };
  /** 1 = Monday. Days outside the span are not part of the plan. */
  weekspan?: { weekdayStart?: number; weekdayEnd?: number };
  display?: Record<string, unknown>;
  lessonTimes?: DaVinciLessonTime[];
  supervisionTimes?: DaVinciSupervisionTime[];
  eventTimes?: DaVinciEventTime[];
}

export interface DaVinciResult {
  teachers?: DaVinciTeacher[];
  classes?: DaVinciClass[];
  rooms?: DaVinciRoom[];
  subjects?: DaVinciSubject[];
  buildings?: DaVinciBuilding[];
  teams?: { id: string; code: string }[];
  resources?: { id: string; code: string }[];
  courses?: Record<string, unknown>[];
  timeframes?: DaVinciTimeframe[];
  teacherAbsenceReasons?: DaVinciAbsenceReason[];
  classAbsenceReasons?: DaVinciAbsenceReason[];
  roomAbsenceReasons?: DaVinciAbsenceReason[];
  teacherAbsences?: Record<string, unknown>[];
  classAbsences?: Record<string, unknown>[];
  roomAbsences?: Record<string, unknown>[];
  firstLesson?: string;
  displaySchedule?: DaVinciDisplaySchedule;
}

export interface DaVinciPayload {
  about?: DaVinciAbout;
  user?: DaVinciUser;
  users?: DaVinciUserRef[];
  result?: DaVinciResult;
}

// ── Endpoint handling ──────────────────────────────────────────────────

/**
 * Turn whatever the user typed in Settings into the `daVinciIS.dll` URL.
 *
 * Mirrors the vendor client's own rules, because schools hand out all of these
 * shapes interchangeably:
 *   "school.de"                      → https://school.de/daVinciIS.dll
 *   "school.de/plan/"                → https://school.de/plan/daVinciIS.dll
 *   "http://school.de:85/daVinciIS.dll" → left alone (scheme and all)
 *
 * A bare host is resolved by `daVinciEndpointCandidates()`, which tries https
 * first and falls back to http — most InfoServer installs are plain http on an
 * odd port, so demanding an explicit scheme would just make setup fail.
 */
export function normalizeDaVinciEndpoint(input: string, scheme: "https" | "http" = "https"): string {
  const raw = input.trim();
  if (!raw) throw new Error("DaVinci-Endpoint ist leer");

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
  const withScheme = hasScheme ? raw : `${scheme}://${raw}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`Ungültiger DaVinci-Endpoint: ${input}`);
  }

  // Anything the user pasted from a browser — query and fragment included — is
  // noise for us; we build the query ourselves.
  url.search = "";
  url.hash = "";

  // A path that doesn't already name the ISAPI entry point is treated as the
  // folder the entry point lives in.
  if (!/daVinciIS\.dll$/i.test(url.pathname)) {
    url.pathname = url.pathname.replace(/\/*$/, "/") + "daVinciIS.dll";
  }
  return url.toString();
}

/**
 * URLs to try, in order. An input that names its own scheme is taken at face
 * value; a bare host yields https first, then http.
 */
export function daVinciEndpointCandidates(input: string): string[] {
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input.trim());
  if (hasScheme) return [normalizeDaVinciEndpoint(input)];
  return [normalizeDaVinciEndpoint(input, "https"), normalizeDaVinciEndpoint(input, "http")];
}

/**
 * Turn undici's opaque "fetch failed" into something a user can act on. The
 * real reason is always one level down in `cause`.
 */
function describeNetworkError(err: unknown, url: string): string {
  const host = (() => { try { return new URL(url).host; } catch { return url; } })();
  const code = (err as { cause?: { code?: string } })?.cause?.code
    ?? (err as { code?: string })?.code;
  switch (code) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return `Server ${host} nicht gefunden — Schreibweise des Endpoints prüfen`;
    case "ECONNREFUSED":
      return `${host} nimmt keine Verbindung an — ggf. fehlt der Port (z.B. ${host}:85)`;
    case "UND_ERR_CONNECT_TIMEOUT":
    case "ETIMEDOUT":
      return `Zeitüberschreitung beim Verbinden mit ${host} — evtl. nur aus dem Schulnetz erreichbar`;
    case "CERT_HAS_EXPIRED":
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
      return `TLS-Zertifikat von ${host} ist ungültig — versuche es mit http:// davor`;
    default:
      break;
  }
  if ((err as Error)?.name === "AbortError") return `${host} hat nicht rechtzeitig geantwortet`;
  return `Keine Verbindung zu ${host}${code ? ` (${code})` : ""}`;
}

/** A transport-level failure, i.e. worth retrying against the next candidate. */
function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError || (err as Error)?.name === "AbortError";
}

export interface DaVinciCredentials {
  /** Anything `normalizeDaVinciEndpoint` accepts. */
  endpoint: string;
  username?: string;
  password?: string;
}

export interface DaVinciFetchOptions extends DaVinciCredentials {
  /** Last known `about.eTag`; lets the server answer "unchanged". */
  etag?: string;
  /** Injected for proxying/tests. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface DaVinciFetchResult {
  /** Null when the server reported the dataset as unchanged. */
  payload: DaVinciPayload | null;
  etag?: string;
  /** True when `etag` matched and no body was transferred. */
  notModified: boolean;
  /**
   * The URL that actually answered. Worth persisting: it saves every later
   * request the dead https attempt, which costs a full connect timeout.
   */
  resolvedEndpoint: string;
}

/**
 * Authentication carries the password as `key`, an MD5 digest — that is what
 * the mobile client sends, and InfoServer builds around 6.5.77 reject the
 * plaintext `password=` form outright (HTTP 910). It is not a security measure
 * (unsalted MD5 over a plaintext channel), just the wire format.
 */
async function md5Hex(input: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("md5").update(input, "utf8").digest("hex");
}

/**
 * The InfoServer signals auth failures with non-standard 9xx status codes
 * (900 = bad key, 910 = bad username/password) instead of 401.
 */
function isAuthStatus(status: number): boolean {
  return status === 401 || status === 403 || (status >= 900 && status < 1000);
}

/**
 * Fetch the dataset.
 *
 * Sent as POST with the query string as the body — the vendor client does the
 * same, and it keeps credentials out of URLs, proxy logs and referrers. Some
 * older InfoServer builds only answer to GET, so we fall back to GET when POST
 * comes back with a client error.
 */
export async function fetchDaVinci(opts: DaVinciFetchOptions): Promise<DaVinciFetchResult> {
  const candidates = daVinciEndpointCandidates(opts.endpoint);
  let lastError: unknown;
  for (const url of candidates) {
    try {
      return await fetchFrom(url, opts);
    } catch (e) {
      // Only a transport failure justifies trying the next scheme; an answer of
      // "wrong password" means we found the right server.
      if (!isNetworkError(e)) throw e;
      lastError = e;
    }
  }
  throw new Error(describeNetworkError(lastError, candidates[0] ?? opts.endpoint));
}

async function fetchFrom(url: string, opts: DaVinciFetchOptions): Promise<DaVinciFetchResult> {
  const doFetch = opts.fetchImpl ?? fetch;

  const params = new URLSearchParams({ content: "json" });
  if (opts.username) {
    // Usernames are handed out with significant whitespace ("IT 25/3 "), so
    // they are passed through byte for byte — only URL-encoded, never trimmed.
    params.set("username", opts.username);
    if (opts.password) params.set("key", await md5Hex(opts.password));
  }
  if (opts.etag) params.set("etag", opts.etag);
  const query = params.toString();

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 20_000);
  try {
    let res = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "text/plain; charset=UTF-8", accept: "application/json" },
      body: query,
      signal: ac.signal,
      redirect: "follow",
    });

    if (res.status >= 400 && res.status < 500) {
      res = await doFetch(`${url}?${query}`, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: ac.signal,
        redirect: "follow",
      });
    }

    if (res.status === 304) return { payload: null, etag: opts.etag, notModified: true, resolvedEndpoint: url };
    if (isAuthStatus(res.status)) {
      throw new Error("Benutzername oder Passwort wurde vom DaVinci-Server abgelehnt");
    }
    if (!res.ok) {
      throw new Error(`DaVinci-Server antwortete mit HTTP ${res.status} ${res.statusText}`);
    }

    // The server prefixes the body with a UTF-8 BOM. `Response.text()` strips
    // it when the charset is declared, but not every build declares one.
    const text = (await res.text()).replace(/^﻿/, "");
    if (!text.trim()) return { payload: null, etag: opts.etag, notModified: true, resolvedEndpoint: url };

    let payload: DaVinciPayload;
    try {
      payload = JSON.parse(text) as DaVinciPayload;
    } catch {
      // A misconfigured endpoint typically lands on the InfoServer's HTML
      // index instead of the JSON handler — say so rather than "bad JSON".
      const looksHtml = /^\s*</.test(text);
      throw new Error(
        looksHtml
          ? "Endpoint lieferte HTML statt JSON — zeigt die URL wirklich auf daVinciIS.dll?"
          : "Antwort des DaVinci-Servers ist kein gültiges JSON",
      );
    }
    if (!payload || typeof payload !== "object" || !payload.about) {
      throw new Error("Antwort sieht nicht nach einem DaVinci-Datensatz aus");
    }

    // Same eTag came back with a full body — the server ignored our
    // conditional request. Treat it as unchanged so callers can skip the work.
    if (opts.etag && payload.about.eTag === opts.etag) {
      return { payload, etag: payload.about.eTag, notModified: true, resolvedEndpoint: url };
    }
    return { payload, etag: payload.about?.eTag, notModified: false, resolvedEndpoint: url };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe an endpoint/credential pair without keeping the (large) payload.
 * Used by Settings to give immediate feedback on "Verbindung testen".
 */
export async function testDaVinciConnection(
  opts: DaVinciFetchOptions,
): Promise<
  | { ok: true; info: DaVinciConnectionInfo; resolvedEndpoint: string }
  | { ok: false; error: string }
> {
  try {
    const { payload, resolvedEndpoint } = await fetchDaVinci({ ...opts, etag: undefined });
    if (!payload) return { ok: false, error: "Server lieferte keine Daten" };
    return { ok: true, info: describeDaVinci(payload), resolvedEndpoint };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export interface DaVinciConnectionInfo {
  serverVersion?: string;
  scheduleDescription?: string;
  /** Publication window, "YYYYMMDD". */
  validFrom?: string;
  validTo?: string;
  profile?: string;
  /** Display name of whoever `user.homeId` points at, when resolvable. */
  identity?: string;
  lessonCount: number;
  classCount: number;
  teacherCount: number;
}

export function describeDaVinci(payload: DaVinciPayload): DaVinciConnectionInfo {
  const r = payload.result ?? {};
  const ds = r.displaySchedule ?? {};
  return {
    serverVersion: payload.about?.serverVersion,
    scheduleDescription: ds.scheduleDescription,
    validFrom: ds.effectivity?.startDate,
    validTo: ds.effectivity?.endDate,
    profile: payload.user?.profile,
    identity: resolveIdentity(payload) ?? undefined,
    lessonCount: ds.lessonTimes?.length ?? 0,
    classCount: r.classes?.length ?? 0,
    teacherCount: r.teachers?.length ?? 0,
  };
}

// ── Normalisation ──────────────────────────────────────────────────────

export type DaVinciEntryKind = "lesson" | "supervision" | "event";

/** One occurrence on one day — what a UI actually wants to render. */
export interface DaVinciEntry {
  kind: DaVinciEntryKind;
  /** "YYYY-MM-DD". */
  date: string;
  /** "HH:MM". */
  start: string;
  end: string;
  /** Period label from the timeframe whose slot matches, when there is one. */
  period?: string;
  /** Subject code, or the supervision/event title. */
  title: string;
  /** Long subject name where the school maintains one. */
  subjectName?: string;
  subjectColor?: string;
  classes: string[];
  /** Teacher short codes, absences removed and substitutes folded in. */
  teachers: string[];
  teacherNames: string[];
  rooms: string[];
  /** Set when the lesson carries a `changes` object. */
  change?: DaVinciEntryChange;
  /** Stable-ish key for keyed rendering. */
  key: string;
}

export interface DaVinciEntryChange {
  type: "cancelled" | "substituted" | "moved" | "extra" | "message" | "modified";
  /** Ready-to-show label, falling back to a sensible German default. */
  caption: string;
  /** Teachers that dropped out, so the UI can strike them through. */
  absentTeachers: string[];
  /** Teachers standing in. */
  newTeachers: string[];
  absentRooms: string[];
  newRooms: string[];
  reason?: string;
  information?: string;
  message?: string;
}

function toIsoDate(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}
function toIsoTime(hhmm: string): string {
  return `${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}`;
}
/** "YYYY-MM-DD" → "YYYYMMDD", the form the wire format uses. */
export function toDaVinciDate(iso: string): string {
  return iso.replace(/-/g, "");
}

export function teacherDisplayName(t: DaVinciTeacher): string {
  const full = [t.firstName, t.lastName].filter(Boolean).join(" ").trim();
  return full || t.code;
}

/** Resolve `user.homeId` against master data to a human-readable name. */
export function resolveIdentity(payload: DaVinciPayload): string | null {
  const u = payload.user;
  const r = payload.result;
  if (!u?.homeId || !r) return null;
  if (u.homeType === "teacher") {
    const t = r.teachers?.find((x) => x.id === u.homeId);
    return t ? teacherDisplayName(t) : null;
  }
  if (u.homeType === "class") {
    return r.classes?.find((x) => x.id === u.homeId)?.code ?? null;
  }
  if (u.homeType === "room") {
    return r.rooms?.find((x) => x.id === u.homeId)?.code ?? null;
  }
  return null;
}

/**
 * The code a personal plan should be filtered by, derived from who the server
 * says we are. Null when the account isn't tied to one object (admin/guest
 * logins), in which case the caller has to let the user pick.
 */
export function personalFilter(
  payload: DaVinciPayload,
): { type: "teacher" | "class" | "room"; code: string } | null {
  const u = payload.user;
  const r = payload.result;
  if (!u?.homeId || !r) return null;
  if (u.homeType === "teacher") {
    const t = r.teachers?.find((x) => x.id === u.homeId);
    return t ? { type: "teacher", code: t.code } : null;
  }
  if (u.homeType === "class") {
    const c = r.classes?.find((x) => x.id === u.homeId);
    return c ? { type: "class", code: c.code } : null;
  }
  if (u.homeType === "room") {
    const room = r.rooms?.find((x) => x.id === u.homeId);
    return room ? { type: "room", code: room.code } : null;
  }
  return null;
}

function classifyChange(c: DaVinciChanges): DaVinciEntryChange["type"] {
  if (c.cancelled) return "cancelled";
  switch (c.changeType) {
    case 3: return "extra";
    case 4: return "message";
    case 6:
    case 7:
    case 8: return "moved";
    default: break;
  }
  if (c.newDate || c.newStartTime) return "moved";
  if (c.newTeacherCodes?.length || c.absentTeacherCodes?.length) return "substituted";
  return "modified";
}

const DEFAULT_CAPTIONS: Record<DaVinciEntryChange["type"], string> = {
  cancelled: "Entfall",
  substituted: "Vertretung",
  moved: "Verlegt",
  extra: "Zusätzlich",
  message: "Mitteilung",
  modified: "Geändert",
};

function buildChange(c: DaVinciChanges): DaVinciEntryChange {
  const type = classifyChange(c);
  return {
    type,
    caption: c.caption?.trim() || DEFAULT_CAPTIONS[type],
    absentTeachers: c.absentTeacherCodes ?? [],
    newTeachers: c.newTeacherCodes ?? [],
    absentRooms: c.absentRoomCodes ?? [],
    newRooms: c.newRoomCodes ?? [],
    reason: c.reasonDescription ?? c.reasonCode,
    information: c.information,
    message: c.message,
  };
}

/**
 * Apply a change to a code list the way the vendor client does: drop whatever
 * is marked absent, then append the replacements (without duplicating).
 */
function effectiveCodes(base: string[] | undefined, absent?: string[], added?: string[]): string[] {
  const gone = new Set(absent ?? []);
  const out = (base ?? []).filter((c) => !gone.has(c));
  for (const c of added ?? []) {
    if (!gone.has(c) && !out.includes(c)) out.push(c);
  }
  return out;
}

export interface ExpandOptions {
  /** Inclusive ISO date bounds ("YYYY-MM-DD"). Omit for the whole dataset. */
  from?: string;
  to?: string;
  /** Keep only entries touching this class code. */
  classCode?: string;
  /** Keep only entries touching this teacher code (before or after the change). */
  teacherCode?: string;
  /** Keep only entries in this room. */
  roomCode?: string;
  /** Include supervision duties (teacher plans want them, students don't). */
  includeSupervisions?: boolean;
}

/**
 * Flatten `displaySchedule` into per-day entries, resolving codes to names and
 * folding substitutions into the effective teacher/room lists.
 */
export function expandDaVinciDays(payload: DaVinciPayload, opts: ExpandOptions = {}): DaVinciEntry[] {
  const r = payload.result ?? {};
  const ds = r.displaySchedule ?? {};
  const from = opts.from ? toDaVinciDate(opts.from) : undefined;
  const to = opts.to ? toDaVinciDate(opts.to) : undefined;

  const subjectByCode = new Map((r.subjects ?? []).map((s) => [s.code, s]));
  const teacherByCode = new Map((r.teachers ?? []).map((t) => [t.code, t]));
  const periodOf = buildPeriodLookup(r.timeframes ?? []);

  const out: DaVinciEntry[] = [];

  const inWindow = (d: string) => (!from || d >= from) && (!to || d <= to);

  const push = (
    kind: DaVinciEntryKind,
    date: string,
    startTime: string,
    endTime: string,
    title: string,
    classes: string[],
    teachers: string[],
    rooms: string[],
    changes: DaVinciChanges | undefined,
    refKey: string,
  ) => {
    const subject = subjectByCode.get(title);
    out.push({
      kind,
      date: toIsoDate(date),
      start: toIsoTime(startTime),
      end: toIsoTime(endTime),
      period: periodOf(startTime),
      title,
      subjectName: subject?.description,
      subjectColor: subject?.color,
      classes,
      teachers,
      teacherNames: teachers.map((c) => {
        const t = teacherByCode.get(c);
        return t ? teacherDisplayName(t) : c;
      }),
      rooms,
      change: changes ? buildChange(changes) : undefined,
      key: `${kind}:${refKey}:${date}:${startTime}`,
    });
  };

  for (const l of ds.lessonTimes ?? []) {
    const ch = l.changes;
    const classes = effectiveCodes(l.classCodes, ch?.absentClassCodes, ch?.newClassCodes);
    const teachers = effectiveCodes(l.teacherCodes, ch?.absentTeacherCodes, ch?.newTeacherCodes);
    const rooms = effectiveCodes(l.roomCodes, ch?.absentRoomCodes, ch?.newRoomCodes);
    // Filters look at the original codes too — a lesson your teacher was pulled
    // out of still belongs on your plan, marked as a substitution.
    if (!matches(opts, l.classCodes, classes, l.teacherCodes, teachers, l.roomCodes, rooms)) continue;

    const title = ch?.newSubjectCode || l.subjectCode || l.courseTitle || "";
    for (const d of l.dates ?? []) {
      if (!inWindow(d)) continue;
      push("lesson", d, l.startTime, l.endTime, title, classes, teachers, rooms, ch, l.lessonRef ?? l.courseRef ?? title);
    }
  }

  if (opts.includeSupervisions) {
    for (const s of ds.supervisionTimes ?? []) {
      const ch = s.changes;
      const teachers = effectiveCodes(s.teacherCodes, ch?.absentTeacherCodes, ch?.newTeacherCodes);
      const rooms = s.areaCode ? [s.areaCode] : [];
      if (!matches(opts, undefined, [], s.teacherCodes, teachers, undefined, rooms)) continue;
      for (const d of s.dates ?? []) {
        if (!inWindow(d)) continue;
        push("supervision", d, s.startTime, s.endTime, s.supervisionTitle ?? "Aufsicht", [], teachers, rooms, ch,
          s.supervisionRef ?? s.supervisionTitle ?? "aufsicht");
      }
    }
  }

  for (const e of ds.eventTimes ?? []) {
    const ch = e.changes;
    const classes = effectiveCodes(e.classCodes, ch?.absentClassCodes, ch?.newClassCodes);
    const teachers = effectiveCodes(e.teacherCodes, ch?.absentTeacherCodes, ch?.newTeacherCodes);
    const rooms = effectiveCodes(e.roomCodes, ch?.absentRoomCodes, ch?.newRoomCodes);
    if (!matches(opts, e.classCodes, classes, e.teacherCodes, teachers, e.roomCodes, rooms)) continue;
    for (const d of e.dates ?? []) {
      if (!inWindow(d)) continue;
      push("event", d, e.startTime, e.endTime, e.eventTitle ?? "Termin", classes, teachers, rooms, ch,
        e.eventTitle ?? "termin");
    }
  }

  out.sort((a, b) => (a.date === b.date ? a.start.localeCompare(b.start) : a.date.localeCompare(b.date)));
  return out;
}

function matches(
  opts: ExpandOptions,
  origClasses: string[] | undefined, effClasses: string[],
  origTeachers: string[] | undefined, effTeachers: string[],
  origRooms: string[] | undefined, effRooms: string[],
): boolean {
  const hit = (code: string | undefined, orig: string[] | undefined, eff: string[]) =>
    !code || eff.includes(code) || (orig ?? []).includes(code);
  return hit(opts.classCode, origClasses, effClasses)
    && hit(opts.teacherCode, origTeachers, effTeachers)
    && hit(opts.roomCode, origRooms, effRooms);
}

/**
 * Map a start time back to its period label. Schools run several timeframes
 * (lessons, supervisions, …); the first exact match wins, otherwise we take the
 * slot the time falls inside.
 */
function buildPeriodLookup(timeframes: DaVinciTimeframe[]): (hhmm: string) => string | undefined {
  const exact = new Map<string, string>();
  const spans: { start: string; end: string; label: string }[] = [];
  for (const tf of timeframes) {
    for (const slot of tf.timeslots ?? []) {
      if (!slot.label) continue;
      if (!exact.has(slot.startTime)) exact.set(slot.startTime, slot.label);
      spans.push({ start: slot.startTime, end: slot.endTime, label: slot.label });
    }
  }
  return (hhmm) => {
    const e = exact.get(hhmm);
    if (e) return e;
    return spans.find((s) => hhmm >= s.start && hhmm < s.end)?.label;
  };
}

/** Distinct class codes, ordered the way the school listed them. */
export function daVinciClasses(payload: DaVinciPayload): string[] {
  return (payload.result?.classes ?? []).map((c) => c.code);
}

/** Distinct teacher codes with display names, for a picker. */
export function daVinciTeachers(payload: DaVinciPayload): { code: string; name: string }[] {
  return (payload.result?.teachers ?? []).map((t) => ({ code: t.code, name: teacherDisplayName(t) }));
}
