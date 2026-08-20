/**
 * Reactive viewport-size detection.
 *
 * `media.mobile` is `true` below the Tailwind `md` breakpoint (< 768px) — the
 * cutoff at which the fixed-width sidebar shells stop fitting and we switch to
 * single-column / drill-down layouts. SSR-safe: defaults to `false` (desktop)
 * so server-rendered markup matches the most common case, then corrects on
 * mount via `matchMedia`.
 */
const MOBILE_QUERY = "(max-width: 767px)";

let isMobile = $state(false);

// Set up at module scope rather than lazily from the getter. Reading
// `media.mobile` happens *during* render, and assigning to `$state` there is a
// `state_unsafe_mutation` error — which Svelte throws out of hydration,
// leaving the whole app server-rendered but dead (no event handlers, forms
// posting natively). The first value is applied in a macrotask so it lands
// after hydration has finished rather than in the middle of it.
if (typeof window !== "undefined" && typeof matchMedia === "function") {
  const mq = matchMedia(MOBILE_QUERY);
  const apply = () => { isMobile = mq.matches; };
  mq.addEventListener("change", apply);
  setTimeout(apply, 0);
}

export const media = {
  /** `true` when the viewport is narrower than the `md` breakpoint. */
  get mobile() {
    return isMobile;
  },
};
