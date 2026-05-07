/** Pick initials from a display name or email. */
export function initials(displayName: string | null | undefined, email?: string | null): string {
  const src = (displayName ?? "").trim();
  if (src) {
    const parts = src.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
    if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  }
  const e = (email ?? "").trim();
  if (e) {
    const local = e.split("@")[0] ?? "";
    const dotted = local.split(/[._-]+/).filter(Boolean);
    if (dotted.length >= 2) return (dotted[0]![0]! + dotted[1]![0]!).toUpperCase();
    return local.slice(0, 2).toUpperCase();
  }
  return "??";
}

/** Stable hue (0..360) derived from a string. */
function hueFor(seed: string): number {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) + h + seed.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** CSS color pair (background + foreground) for an avatar derived from a stable seed. */
export function avatarColor(seed: string): { bg: string; fg: string } {
  const hue = hueFor(seed || "x");
  return {
    bg: `hsl(${hue} 60% 35%)`,
    fg: `hsl(${hue} 80% 90%)`,
  };
}
