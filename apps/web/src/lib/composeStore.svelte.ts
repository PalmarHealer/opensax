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
  close() {
    state.open = false;
    state.minimized = false;
    state.draft = { ...empty };
  },
  patch(patch: Partial<Draft>) {
    state.draft = { ...state.draft, ...patch };
  },
};
