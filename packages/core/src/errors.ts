export class LernSaxError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly method?: string,
    public readonly raw?: unknown,
  ) {
    super(message);
    this.name = "LernSaxError";
  }
}

export class LernSaxAuthError extends LernSaxError {
  constructor(message: string, code: number, method?: string, raw?: unknown) {
    super(message, code, method, raw);
    this.name = "LernSaxAuthError";
  }
}

/**
 * Why LernSax turned a login down, in terms the UI can act on:
 * - `credentials`: wrong email/password
 * - `totp_required`: the account has 2FA, ask for a code and try again
 * - `totp_invalid`: the code was wrong, already used, or LernSax was still busy with the last one
 * - `trust_revoked`: the stored auth token no longer works (revoked in LernSax, password changed)
 * - `unsupported`: the account can't sign in this way at all (password login disabled, MFA mandatory but not set up)
 */
export type LoginFailure = "credentials" | "totp_required" | "totp_invalid" | "trust_revoked" | "unsupported";

export class LernSaxLoginError extends LernSaxError {
  constructor(
    message: string,
    public readonly reason: LoginFailure,
    code: number,
    raw?: unknown,
  ) {
    super(message, code, "login", raw);
    this.name = "LernSaxLoginError";
  }
}

export class LernSaxTransportError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "LernSaxTransportError";
  }
}

// Legacy code-based markers retained for compatibility; the live API uses
// `result.return === "OK"` strings, handled in transport.ts.
export const OK_RETURN = "OK";
