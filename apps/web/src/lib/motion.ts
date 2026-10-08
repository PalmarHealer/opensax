/**
 * Dauer für Svelte-Transitions: 0, wenn das System „Bewegung reduzieren“
 * eingestellt hat, sonst die gewünschte Dauer.
 */
export function motion(ms: number): number {
  if (typeof matchMedia !== "function") return ms;
  return matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : ms;
}
