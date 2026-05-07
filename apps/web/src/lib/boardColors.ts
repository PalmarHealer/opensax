// LernSax board entry colors. The API stores the index 0..7.
// Mapping intentionally close to the original LernSax palette but tuned for dark UI.
export interface BoardColor {
  id: number;
  label: string;
  /** Tailwind classes for accent stripe + soft tint */
  accent: string;
  tint: string;
  border: string;
  swatch: string;
}

export const BOARD_COLORS: BoardColor[] = [
  { id: 0, label: "Standard", accent: "bg-zinc-500",   tint: "bg-zinc-900/40",     border: "border-zinc-800",       swatch: "bg-zinc-500" },
  { id: 1, label: "Rot",      accent: "bg-rose-500",   tint: "bg-rose-500/10",     border: "border-rose-500/40",    swatch: "bg-rose-500" },
  { id: 2, label: "Orange",   accent: "bg-orange-500", tint: "bg-orange-500/10",   border: "border-orange-500/40",  swatch: "bg-orange-500" },
  { id: 3, label: "Gelb",     accent: "bg-amber-400",  tint: "bg-amber-400/10",    border: "border-amber-400/40",   swatch: "bg-amber-400" },
  { id: 4, label: "Grün",     accent: "bg-emerald-500",tint: "bg-emerald-500/10",  border: "border-emerald-500/40", swatch: "bg-emerald-500" },
  { id: 5, label: "Blau",     accent: "bg-sky-500",    tint: "bg-sky-500/10",      border: "border-sky-500/40",     swatch: "bg-sky-500" },
  { id: 6, label: "Lila",     accent: "bg-violet-500", tint: "bg-violet-500/10",   border: "border-violet-500/40",  swatch: "bg-violet-500" },
  { id: 7, label: "Pink",     accent: "bg-pink-500",   tint: "bg-pink-500/10",     border: "border-pink-500/40",    swatch: "bg-pink-500" },
];

export function boardColor(id: number | undefined): BoardColor {
  return BOARD_COLORS[id ?? 0] ?? BOARD_COLORS[0]!;
}
