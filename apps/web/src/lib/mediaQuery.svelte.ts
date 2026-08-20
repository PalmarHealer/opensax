/**
 * Reactive viewport-size detection.
 *
 * Three bands, matching Tailwind's `md` and `xl`:
 *   mobile   < 768px   single column, drill-down layouts
 *   tablet   768–1279  the content grids fit, a second 240px rail does not
 *   desktop  ≥ 1280px  page rail plus content side by side
 *
 * The middle band exists because "not a phone" is not the same as "room for
 * two sidebars": a page rail (240px) next to the app rail and a week grid
 * needs ~1300px before nothing has to scroll sideways.
 *
 * SSR-safe: defaults to desktop, the most common case, then corrects on mount.
 */
const MOBILE_QUERY = "(max-width: 767px)";
const DESKTOP_QUERY = "(min-width: 1280px)";

let isMobile = $state(false);
let isDesktop = $state(true);

// Set up at module scope rather than lazily from the getters. Reading these
// happens *during* render, and assigning to `$state` there is a
// `state_unsafe_mutation` error — which Svelte throws out of hydration,
// leaving the whole app server-rendered but dead (no event handlers, forms
// posting natively). The first values are applied in a macrotask so they land
// after hydration has finished rather than in the middle of it.
if (typeof window !== "undefined" && typeof matchMedia === "function") {
  const mobileMq = matchMedia(MOBILE_QUERY);
  const desktopMq = matchMedia(DESKTOP_QUERY);
  const apply = () => {
    isMobile = mobileMq.matches;
    isDesktop = desktopMq.matches;
  };
  mobileMq.addEventListener("change", apply);
  desktopMq.addEventListener("change", apply);
  setTimeout(apply, 0);
}

export const media = {
  /** `true` below the `md` breakpoint. */
  get mobile() {
    return isMobile;
  },
  /** Between the bands — wide enough for grids, too narrow for a second rail. */
  get tablet() {
    return !isMobile && !isDesktop;
  },
  /** `true` from the `xl` breakpoint up. */
  get desktop() {
    return isDesktop;
  },
};
