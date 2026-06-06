/**
 * Per-route rules for which group "scopes" the sidebar should show.
 * - "personal" → the "Persönlich" entry
 * - "school"   → groups with type 16 (Schule)
 * - "class"    → groups with type 19 (Klasse) — and other room/group types we treat alike
 *
 * If a route is not listed, all scopes are shown.
 */
export type Scope = "personal" | "school" | "class";

export const ROUTE_SCOPES: Record<string, Scope[]> = {
  // Dashboard pulls aggregated data — no per-group switcher needed.
  "/":          ["personal"],
  "/tasks":     ["personal", "class"],
  "/calendar":  ["personal", "class"],
  "/board":     ["school", "class"],
  "/wiki":      ["school", "class"],
  "/forum":     ["school", "class"],
  "/notes":     ["personal"],
  "/mail":      ["personal"],
  "/messenger": ["personal"],
  "/settings":  ["personal"],
};

export function scopesFor(pathname: string): Scope[] | null {
  // longest-prefix match
  let best: Scope[] | null = null;
  let bestLen = -1;
  for (const [route, scopes] of Object.entries(ROUTE_SCOPES)) {
    if ((pathname === route || pathname.startsWith(route + "/")) && route.length > bestLen) {
      bestLen = route.length;
      best = scopes;
    }
  }
  return best;
}

export function groupScope(group: { type?: number | string | null }): Scope {
  const t = typeof group.type === "string" ? Number.parseInt(group.type, 10) : group.type ?? 0;
  if (t === 16) return "school";
  return "class";
}

// Tab definitions for the navigation rail (used by settings/nav customization).
export interface NavTab {
  id: string;
  href: string;
  label: string;
  icon: string;
}

export const NAV_TABS: NavTab[] = [
  { id: "home",      href: "/",          label: "Übersicht",     icon: "home" },
  { id: "mail",      href: "/mail",      label: "Mail",          icon: "mail" },
  { id: "tasks",     href: "/tasks",     label: "Aufgaben",      icon: "list-check" },
  { id: "calendar",  href: "/calendar",  label: "Kalender",      icon: "calendar" },
  { id: "board",     href: "/board",     label: "Mitteilungen",  icon: "speakerphone" },
  { id: "notes",     href: "/notes",     label: "Notizen",       icon: "sticky-note" },
  { id: "messenger", href: "/messenger", label: "Chat",          icon: "message-circle" },
  { id: "files",     href: "/files",     label: "Dateien",       icon: "folder" },
  { id: "forum",     href: "/forum",     label: "Forum",         icon: "message-2" },
  { id: "wiki",      href: "/wiki",      label: "Wiki",          icon: "book-2" },
  { id: "settings",  href: "/settings",  label: "Einstellungen", icon: "settings" },
];

const NAV_STORAGE_KEY = "lernsax.nav.v2";

export type NavMode = "sidenav" | "topnav";

export interface NavConfig {
  /** Ordered list of tab IDs that should be shown (excluding "home" which is always first). */
  visible: string[];
  /** Tab IDs the user has explicitly hidden. */
  hidden: string[];
  /** Where to render the navigation rail. */
  mode: NavMode;
}

function defaultConfig(): NavConfig {
  return {
    visible: NAV_TABS.filter((t) => t.id !== "home").map((t) => t.id),
    hidden: [],
    mode: "sidenav",
  };
}

export function loadNavConfig(): NavConfig {
  if (typeof localStorage === "undefined") return defaultConfig();
  const raw = localStorage.getItem(NAV_STORAGE_KEY);
  if (!raw) return defaultConfig();
  try {
    const cfg = JSON.parse(raw) as Partial<NavConfig>;
    const known = new Set(NAV_TABS.map((t) => t.id));
    const visible = (cfg.visible ?? []).filter((id) => known.has(id) && id !== "home");
    const hidden = (cfg.hidden ?? []).filter((id) => known.has(id) && id !== "home");
    for (const t of NAV_TABS) {
      if (t.id === "home") continue;
      if (!visible.includes(t.id) && !hidden.includes(t.id)) visible.push(t.id);
    }
    const mode: NavMode = cfg.mode === "topnav" ? "topnav" : "sidenav";
    return { visible, hidden, mode };
  } catch {
    return defaultConfig();
  }
}

export function saveNavConfig(cfg: NavConfig): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(NAV_STORAGE_KEY, JSON.stringify(cfg));
}

export function tabById(id: string): NavTab | undefined {
  return NAV_TABS.find((t) => t.id === id);
}

/**
 * Pick up to `count` tabs for the mobile bottom bar. These come straight from
 * the user's configured `visible` tabs IN THEIR ORDER (so reordering/hiding a
 * tab in settings also reshapes the bottom bar), with "Übersicht" pinned first
 * since it has no other dedicated mobile entry point. Tabs beyond `count` spill
 * into the drawer's "Mehr" list.
 */
export function mobileBottomTabs(visible: NavTab[], count = 5): NavTab[] {
  const home = tabById("home");
  const picked: NavTab[] = [];
  const seen = new Set<string>();
  const add = (t: NavTab | undefined) => {
    if (t && !seen.has(t.id)) {
      seen.add(t.id);
      picked.push(t);
    }
  };
  // "Übersicht" is always the first bottom-bar entry.
  add(home);
  // Then the user's visible tabs, in their configured order.
  for (const t of visible) {
    if (picked.length >= count) break;
    add(t);
  }
  return picked.slice(0, count);
}
