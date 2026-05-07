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

export class LernSaxTransportError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "LernSaxTransportError";
  }
}

// Legacy code-based markers retained for compatibility; the live API uses
// `result.return === "OK"` strings, handled in transport.ts.
export const OK_RETURN = "OK";
