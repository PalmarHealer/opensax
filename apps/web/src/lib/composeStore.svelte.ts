/**
 * Global state for the floating mail-compose window.
 *
 * Lives outside the component tree so that the window can persist across
 * navigation (typical email client UX: minimize, browse other mails, restore).
 */
export interface Draft {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  reply_id?: string;
  forward_id?: string;
  /** Server-side id of the saved LernSax draft, once it has been persisted. */
  draftId?: string;
}

export interface ComposeState {
  open: boolean;
  minimized: boolean;
  draft: Draft;
}

const empty: Draft = { to: "", cc: "", bcc: "", subject: "", body: "" };

let state = $state<ComposeState>({ open: false, minimized: false, draft: { ...empty } });

export const composeStore = {
  get open() { return state.open; },
  get minimized() { return state.minimized; },
  get draft() { return state.draft; },
  openNew() {
    state.open = true;
    state.minimized = false;
    state.draft = { ...empty };
  },
  openWith(draft: Partial<Draft>) {
    state.open = true;
    state.minimized = false;
    state.draft = { ...empty, ...draft };
  },
  toggleMinimize() {
    state.minimized = !state.minimized;
  },
  /**
   * Close the window and clear the local draft. This does NOT touch any
   * server-side draft that may already have been saved — used when the draft
   * has been (or will be) persisted to LernSax Drafts.
   */
  close() {
    state.open = false;
    state.minimized = false;
    state.draft = { ...empty };
  },
  /**
   * Discard the draft locally (reset + close). Deleting any autosaved
   * server-side draft is handled by the caller (ComposeWindow) before this,
   * since it requires a network round-trip.
   */
  discard() {
    state.open = false;
    state.minimized = false;
    state.draft = { ...empty };
  },
  patch(patch: Partial<Draft>) {
    state.draft = { ...state.draft, ...patch };
  },
  setDraftId(id: string | undefined) {
    state.draft = { ...state.draft, draftId: id };
  },
  /** True when the draft has any user-entered content worth persisting. */
  isNonEmpty(): boolean {
    const d = state.draft;
    return Boolean(
      d.to.trim() ||
        d.cc.trim() ||
        d.bcc.trim() ||
        d.subject.trim() ||
        d.body.trim(),
    );
  },
};
