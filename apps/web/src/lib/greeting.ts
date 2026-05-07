// Texts may contain {name}. If a firstName is present, it is substituted;
// otherwise "{name}" is removed together with surrounding ", " or whitespace.

type Pool = readonly string[];

const night: Pool = [
  "Mondschein-Plausch, {name}?",
  "Nachteule {name}",
  "Noch wach, {name}?",
  "Nachtschicht, {name}",
  "Eulenstunde",
  "Schon wieder du, {name}?",
];

const veryLate: Pool = [
  "Geh schlafen, {name}",
  "Ernsthaft, {name}?",
  "Es ist spät, {name}",
  "Wirklich noch wach?",
];

const morning: Pool = [
  "Guten Morgen, {name}",
  "Morgenstund, {name}",
  "Schon wach, {name}?",
  "Moin, {name}",
  "Kaffee, {name}?",
  "Bereit für den Tag, {name}?",
];

const day: Pool = [
  "Hallo, {name}",
  "Servus, {name}",
  "Tagchen, {name}",
  "Schön dich zu sehen, {name}",
  "Was geht, {name}?",
  "Hi, {name}",
];

const evening: Pool = [
  "Guten Abend, {name}",
  "Feierabend, {name}?",
  "Schönen Abend, {name}",
  "Noch was vor, {name}?",
  "N'Abend, {name}",
  "Abendrunde",
];

const monday: Pool = [
  "Neue Woche, {name}",
  "Montag, {name}…",
  "Wochenstart, {name}",
];

const friday: Pool = [
  "Endlich Freitag, {name}",
  "Freitag, {name}!",
  "Wochenende in Sicht, {name}",
];

const sunday: Pool = [
  "Noch ein Tag, {name}…",
  "Sonntag, {name}",
  "Letzter freier Tag, {name}?",
];

const specials: Record<string, Pool> = {
  newYear: [
    "Frohes neues Jahr, {name}",
    "Happy New Year, {name}",
    "Prost Neujahr, {name}",
    "Neuer Anfang, {name}",
  ],
  valentine: [
    "Happy Valentine's, {name}",
    "Tag der Liebe, {name}",
    "Valentinstag, {name}",
    "Schon verliebt, {name}?",
  ],
  womensDay: [
    "Happy Women's Day",
    "Weltfrauentag, {name}",
    "Frauen rocken",
    "Equal rights, {name}",
  ],
  stPatricks: [
    "Sláinte, {name}!",
    "Happy St. Patrick's, {name}",
    "Grün heute, {name}?",
    "Erin go bragh",
  ],
  easter: [
    "Frohe Ostern, {name}",
    "Eier gefunden, {name}?",
    "Hoppy Easter, {name}",
    "Hase gesehen, {name}?",
  ],
  laborDay: [
    "Tag der Arbeit, {name}",
    "Frei heute, {name}?",
    "Mai-Feiertag, {name}",
    "Arbeiterklasse, {name}",
  ],
  pride: [
    "Happy Pride, {name} 🏳️‍🌈",
    "Pride Day, {name}",
    "Love is love, {name}",
    "Stolz und schön, {name}",
  ],
  halloween: [
    "Boo!",
    "Happy Halloween, {name}",
    "Süßes oder Saures, {name}?",
    "Spooky, {name}?",
  ],
  nikolaus: [
    "Frohen Nikolaus, {name}",
    "Stiefel geputzt, {name}?",
    "Nikolaus war da, {name}?",
    "Brav gewesen, {name}?",
  ],
  christmas: [
    "Frohe Weihnachten, {name}",
    "Merry Christmas, {name}",
    "Festtage, {name}",
    "Bescherung, {name}?",
  ],
  newYearsEve: [
    "Guten Rutsch, {name}",
    "Silvester, {name}",
    "Letzter Tag des Jahres, {name}",
    "Bald ist's soweit, {name}",
  ],
};

// Anonymous Gregorian algorithm (Meeus/Jones/Butcher).
function easterDate(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

function specialKey(date: Date): keyof typeof specials | null {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const y = date.getFullYear();

  if (m === 1 && d === 1) return "newYear";
  if (m === 2 && d === 14) return "valentine";
  if (m === 3 && d === 8) return "womensDay";
  if (m === 3 && d === 17) return "stPatricks";
  if (m === 5 && d === 1) return "laborDay";
  if (m === 6 && d === 28) return "pride";
  if (m === 10 && d === 31) return "halloween";
  if (m === 12 && d === 6) return "nikolaus";
  if (m === 12 && (d === 24 || d === 25 || d === 26)) return "christmas";
  if (m === 12 && d === 31) return "newYearsEve";

  const easter = easterDate(y);
  if (m === easter.month && d === easter.day) return "easter";
  // Easter Monday = next day
  const eMonday = new Date(y, easter.month - 1, easter.day + 1);
  if (m === eMonday.getMonth() + 1 && d === eMonday.getDate()) return "easter";

  return null;
}

// Deterministic per-day pseudo-random based on date.
function dateSeed(date: Date): number {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

function hash32(n: number): number {
  let t = (n + 0x9e3779b9) >>> 0;
  t = Math.imul(t ^ (t >>> 15), 0x85ebca6b) >>> 0;
  t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35) >>> 0;
  return (t ^ (t >>> 16)) >>> 0;
}

function pick<T>(arr: readonly T[], seed: number): T {
  return arr[hash32(seed) % arr.length];
}

function applyName(text: string, name: string): string {
  if (name) return text.replace(/\{name\}/g, name);
  return text
    .replace(/,?\s*\{name\}\s*/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([?!.,…])/g, "$1")
    .trim();
}

export function getGreeting(firstName: string, now: Date = new Date()): string {
  const seed = dateSeed(now);
  const h = now.getHours();
  const dow = now.getDay(); // 0 = Sun, 1 = Mon, ... 5 = Fri

  // 1. Special day
  const sk = specialKey(now);
  if (sk) return applyName(pick(specials[sk], seed), firstName);

  // 2. Very late
  if (h >= 2 && h < 5) return applyName(pick(veryLate, seed), firstName);

  // 3. Weekday special with ~30% chance
  const weekdayPool = dow === 1 ? monday : dow === 5 ? friday : dow === 0 ? sunday : null;
  if (weekdayPool && hash32(seed ^ 0xabcdef) % 100 < 30) {
    return applyName(pick(weekdayPool, seed), firstName);
  }

  // 4. Time-of-day pool
  let pool: Pool;
  if (h < 5) pool = night;
  else if (h < 11) pool = morning;
  else if (h < 18) pool = day;
  else pool = evening;

  return applyName(pick(pool, seed), firstName);
}
