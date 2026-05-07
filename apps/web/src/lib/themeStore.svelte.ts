/**
 * Light / Dark / System theme management.
 *
 * `theme` is the user's preference (persisted to localStorage). `effective`
 * is the actually applied palette ("light" | "dark"). On `theme === "system"`,
 * the effective palette tracks `prefers-color-scheme` live.
 */
export type ThemePref = "light" | "dark" | "system";
export type EffectiveTheme = "light" | "dark";

const STORAGE_KEY = "lernsax.theme.v1";

let pref = $state<ThemePref>("dark");
let effective = $state<EffectiveTheme>("dark");
let mq: MediaQueryList | null = null;

function systemTheme(): EffectiveTheme {
  if (typeof matchMedia !== "function") return "dark";
  return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function apply() {
  if (typeof document === "undefined") return;
  effective = pref === "system" ? systemTheme() : pref;
  document.documentElement.classList.toggle("dark", effective === "dark");
  document.documentElement.classList.toggle("light", effective === "light");
  document.documentElement.style.colorScheme = effective;
  // Cookie so server-side renders (e.g. OnlyOffice editor config) can pick the
  // matching theme without a round-trip from the client.
  document.cookie = `lernsax_theme=${effective}; path=/; max-age=31536000; SameSite=Lax`;
}

export const theme = {
  get pref() { return pref; },
  get effective() { return effective; },
  init() {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem(STORAGE_KEY) as ThemePref | null;
    pref = stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
    apply();
    mq = matchMedia("(prefers-color-scheme: light)");
    const onChange = () => { if (pref === "system") apply(); };
    mq.addEventListener("change", onChange);
  },
  set(next: ThemePref) {
    pref = next;
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, next);
    apply();
  },
};
