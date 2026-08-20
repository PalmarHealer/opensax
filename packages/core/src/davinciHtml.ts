/**
 * Reader for DaVinci's *static HTML export* — the other way schools publish
 * their plan, next to the InfoServer.
 *
 * Instead of one JSON endpoint there is a generated site: an index page with a
 * month calendar whose day buttons link to one page per day, each holding a
 * table of that day's changes. No login, and no full timetable — only what
 * deviates from it.
 *
 *   index.html   →  <input class="day" onClick="…href='V_DC_001.html'">
 *   V_DC_001.html →  <h1 class="list-table-caption">Mittwoch 19.08.2026</h1>
 *                    <table class="list-table"> Klasse | Pos | Fach | … </table>
 *
 * Cell conventions the generator uses inside those tables:
 *   "Ma"            unchanged
 *   "(KRA)"         dropped — the teacher is out, nothing replaces them
 *   "+SUB (BKR)"    replaced — SUB stands in for BKR
 *
 * Parsed with regexes rather than a DOM: core has no DOM dependency, and this
 * markup comes out of one code generator, so it is far more predictable than
 * hand-written HTML.
 */
import type { DaVinciEntry, DaVinciEntryChange } from "./davinci.js";

export interface DaVinciHtmlOptions {
  /** Index page or the folder containing it. */
  endpoint: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Only fetch day pages inside this inclusive ISO range. */
  from?: string;
  to?: string;
}

export interface DaVinciHtmlResult {
  entries: DaVinciEntry[];
  /** Day pages that were read, as ISO dates. */
  dates: string[];
  /** "Fehlende Klassen: …" notes, keyed by ISO date. */
  notes: Record<string, string>;
  /** Footer stamp of the generator run, if the export carries one. */
  generatedAt?: string;
  /** Index URL that answered. */
  resolvedEndpoint: string;
}

/** Strip tags and decode the handful of entities the generator emits. */
function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The export is a directory of generated pages, so the endpoint is treated as
 * a folder unless it already names an .html file.
 */
export function normalizeHtmlEndpoint(input: string): string {
  const raw = input.trim();
  if (!raw) throw new Error("DaVinci-Endpoint ist leer");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`Ungültiger DaVinci-Endpoint: ${input}`);
  }
  url.search = "";
  url.hash = "";
  if (!/\.html?$/i.test(url.pathname)) {
    url.pathname = url.pathname.replace(/\/*$/, "/") + "index.html";
  }
  return url.toString();
}

async function get(url: string, opts: DaVinciHtmlOptions): Promise<string> {
  const doFetch = opts.fetchImpl ?? fetch;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 20_000);
  try {
    const res = await doFetch(url, { signal: ac.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status} für ${url}`);
    // The generator writes a UTF-8 BOM; it would otherwise land in the first
    // parsed value.
    return (await res.text()).replace(/^﻿/, "");
  } finally {
    clearTimeout(timer);
  }
}

/** True when a page looks like it came out of the DaVinci HTML generator. */
export function looksLikeDaVinciHtml(html: string): boolean {
  return /GENERATOR"?\s+content="DaVinci/i.test(html)
    || /CREATED BY DaVinci/i.test(html)
    || /class="(month|list-table)"/i.test(html);
}

/** Day-page links from the index calendar, in document order. */
function dayPageLinks(indexHtml: string): string[] {
  const out: string[] = [];
  for (const m of indexHtml.matchAll(/onClick\s*=\s*"window\.location\.href\s*=\s*'([^']+\.html?)'"/gi)) {
    const href = m[1];
    if (!href) continue;
    // The nav bar reuses the same handler for home/search/prev/next; only the
    // calendar buttons are day pages.
    if (/^index\.html?$/i.test(href)) continue;
    if (!out.includes(href)) out.push(href);
  }
  return out;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, "mär": 3, maer: 3, apr: 4, may: 5, mai: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, dez: 12,
};

/**
 * Dates the index advertises, as ISO strings, aligned with `dayPageLinks()`.
 *
 * Lets us skip fetching days outside the week on screen. It is a hint, not the
 * truth — each day page carries its own date in the caption, and that wins.
 */
function indexDates(indexHtml: string): (string | null)[] {
  const out: (string | null)[] = [];
  // Month headings and day buttons interleave, so walk the document once and
  // remember the most recent heading.
  let year = 0;
  let month = 0;
  const token = /<h1>\s*(\d{4})-([A-Za-zäÄ]+)\s*<\/h1>|<input[^>]*class="day[^"]*"[^>]*value="(\d{1,2})"[^>]*onClick[^>]*'([^']+\.html?)'/gi;
  for (const m of indexHtml.matchAll(token)) {
    if (m[1] && m[2]) {
      year = Number(m[1]);
      month = MONTHS[m[2].toLowerCase().slice(0, 3)] ?? 0;
      continue;
    }
    if (m[3] && year && month) {
      out.push(`${year}-${String(month).padStart(2, "0")}-${m[3].padStart(2, "0")}`);
    } else {
      out.push(null);
    }
  }
  return out;
}

/** "Mittwoch 19.08.2026" → "2026-08-19". */
function captionDate(html: string): string | null {
  const m = html.match(/class="list-table-caption"[^>]*>([\s\S]*?)<\/h1>/i);
  if (!m || !m[1]) return null;
  const d = text(m[1]).match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!d) return null;
  return `${d[3]}-${d[2]!.padStart(2, "0")}-${d[1]!.padStart(2, "0")}`;
}

interface Cell {
  /** What applies now. Empty when the slot is dropped entirely. */
  value: string;
  /** What it replaced, when the generator spelled it out. */
  previous?: string;
}

/**
 * Read one table cell.
 *
 *   "+SUB (BKR)" → { value: "SUB", previous: "BKR" }
 *   "(KRA)"      → { value: "",    previous: "KRA" }
 *   "Ma"         → { value: "Ma" }
 */
function parseCell(raw: string): Cell {
  const s = raw.trim();
  if (!s) return { value: "" };

  const replaced = s.match(/^\+\s*(.+?)\s*\(\s*(.+?)\s*\)$/);
  if (replaced) return { value: replaced[1]!.trim(), previous: replaced[2]!.trim() };

  const dropped = s.match(/^\(\s*(.+?)\s*\)$/);
  if (dropped) return { value: "", previous: dropped[1]!.trim() };

  return { value: s.replace(/^\+\s*/, "").trim() };
}

/**
 * Split a multi-value cell. Comma only — a slash is part of the name here
 * ("IT 25/3", "BVJ 26/2"), not a separator.
 */
const splitCodes = (s: string): string[] =>
  s.split(",").map((x) => x.trim()).filter(Boolean);

/** Header aliases the generator uses across its table layouts. */
const COLUMNS: Record<string, string[]> = {
  class: ["klasse", "klassen"],
  period: ["pos", "stunde", "std.", "std", "ue", "dstd."],
  subject: ["fach", "vfach", "v fach"],
  teacher: ["lehrer", "vlehrer", "lehrkraft", "vertreter", "vertretungslehrkraft", "lehrer kürzel"],
  room: ["raum", "vraum", "v raum"],
  kind: ["art", "merkmal"],
  note: ["bemerkung", "info", "information", "mitteilung"],
};

function columnIndexes(headers: string[]): Record<string, number> {
  const idx: Record<string, number> = {};
  headers.forEach((h, i) => {
    const key = h.toLowerCase().trim();
    for (const [field, aliases] of Object.entries(COLUMNS)) {
      if (idx[field] === undefined && aliases.includes(key)) idx[field] = i;
    }
  });
  return idx;
}

function classifyKind(kind: string): DaVinciEntryChange["type"] {
  const k = kind.toLowerCase();
  if (k.includes("ausfall") || k.includes("entfall") || k.includes("frei")) return "cancelled";
  // "Auf 19.08. Mi 1 verschoben" — this slot is the one being vacated.
  if (/^auf\b/.test(k) && k.includes("verschoben")) return "cancelled";
  if (/^von\b/.test(k) && k.includes("verschoben")) return "moved";
  if (k.includes("verschoben")) return "moved";
  if (k.includes("zusätzlich") || k.includes("zusatz")) return "extra";
  if (k.includes("vertret")) return "substituted";
  if (k.includes("mitteilung") || k.includes("information")) return "message";
  return "modified";
}

function parseDayPage(html: string, url: string): { date: string | null; note?: string; entries: DaVinciEntry[] } {
  const date = captionDate(html);
  const noteMatch = html.match(/<p>([\s\S]*?)<\/p>/i);
  const note = noteMatch && noteMatch[1] ? text(noteMatch[1]) || undefined : undefined;

  const table = html.match(/<table[^>]*class="[^"]*list-table[^"]*"[^>]*>([\s\S]*?)<\/table>/i);
  if (!table || !table[1] || !date) return { date, note, entries: [] };

  const rows = [...table[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((m) => [...(m[1] ?? "").matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => text(c[1] ?? "")));

  const header = rows.find((r) => r.length > 0);
  if (!header) return { date, note, entries: [] };
  const col = columnIndexes(header);

  const entries: DaVinciEntry[] = [];
  for (const [i, row] of rows.entries()) {
    if (i === 0) continue; // header
    if (row.length < 2 || row.every((c) => !c)) continue;

    const at = (field: string): Cell =>
      col[field] === undefined ? { value: "" } : parseCell(row[col[field]!] ?? "");

    const subject = at("subject");
    const teacher = at("teacher");
    const room = at("room");
    const klass = at("class");
    const kind = at("kind").value;
    const note2 = at("note").value;
    const period = at("period").value;

    const type = classifyKind(kind);
    const change: DaVinciEntryChange = {
      type,
      caption: kind || (type === "cancelled" ? "Ausfall" : "Geändert"),
      absentTeachers: teacher.previous ? [teacher.previous] : [],
      newTeachers: teacher.previous && teacher.value ? splitCodes(teacher.value) : [],
      absentRooms: room.previous ? [room.previous] : [],
      newRooms: room.previous && room.value ? splitCodes(room.value) : [],
      information: note2 || undefined,
    };

    entries.push({
      kind: "lesson",
      date,
      // The export prints period numbers, never clock times.
      start: "",
      end: "",
      period: period || undefined,
      title: subject.value || subject.previous || "",
      classes: splitCodes(klass.value || klass.previous || ""),
      teachers: splitCodes(teacher.value),
      teacherNames: splitCodes(teacher.value),
      rooms: splitCodes(room.value),
      change,
      key: `html:${url}:${i}`,
    });
  }
  return { date, note, entries };
}

/**
 * Read a published HTML export.
 *
 * The index is fetched first to learn which day pages exist; only those inside
 * `from`/`to` are then downloaded. The index's dates are a hint used for that
 * filtering — the authoritative date is the caption on each day page.
 */
export async function fetchDaVinciHtml(opts: DaVinciHtmlOptions): Promise<DaVinciHtmlResult> {
  const indexUrl = normalizeHtmlEndpoint(opts.endpoint);
  const indexHtml = await get(indexUrl, opts);
  if (!looksLikeDaVinciHtml(indexHtml)) {
    throw new Error("Die Seite sieht nicht nach einem DaVinci-HTML-Export aus");
  }

  const links = dayPageLinks(indexHtml);
  const hinted = indexDates(indexHtml);
  const wanted = links.filter((_, i) => {
    const d = hinted[i];
    if (!d) return true; // no hint — fetch and let the caption decide
    if (opts.from && d < opts.from) return false;
    if (opts.to && d > opts.to) return false;
    return true;
  });

  const pages = await Promise.all(
    wanted.map(async (href) => {
      const url = new URL(href, indexUrl).toString();
      try {
        return { url, html: await get(url, opts) };
      } catch {
        // One unreachable day must not take the whole week down.
        return null;
      }
    }),
  );

  const entries: DaVinciEntry[] = [];
  const notes: Record<string, string> = {};
  const dates: string[] = [];
  for (const page of pages) {
    if (!page) continue;
    const parsed = parseDayPage(page.html, page.url);
    if (!parsed.date) continue;
    if (opts.from && parsed.date < opts.from) continue;
    if (opts.to && parsed.date > opts.to) continue;
    dates.push(parsed.date);
    if (parsed.note) notes[parsed.date] = parsed.note;
    entries.push(...parsed.entries);
  }

  const stamp = indexHtml.match(/(\d{2}-\d{2}-\d{4} \d{2}:\d{2})\s*\|/);

  entries.sort((a, b) => a.date.localeCompare(b.date)
    || (a.period ?? "").padStart(3, "0").localeCompare((b.period ?? "").padStart(3, "0")));

  return {
    entries,
    dates: [...new Set(dates)].sort(),
    notes,
    generatedAt: stamp?.[1],
    resolvedEndpoint: indexUrl,
  };
}
