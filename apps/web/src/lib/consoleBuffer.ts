/**
 * Ring buffer of what the browser console saw, for bug reports.
 *
 * Installed once from `hooks.client.ts`, so it already holds the history by
 * the time someone opens the feedback wizard — a log captured only after the
 * fact would miss exactly the error they want to report. Nothing leaves the
 * browser unless the user ticks "Browser-Logs" in the wizard.
 */
export interface LogEntry {
  /** ms since epoch */
  t: number;
  level: "log" | "info" | "warn" | "error" | "debug";
  msg: string;
}

const MAX_ENTRIES = 200;
const MAX_MSG = 2000;
const entries: LogEntry[] = [];
let installed = false;

function fmt(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}${arg.stack ? `\n${arg.stack}` : ""}`;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function push(level: LogEntry["level"], args: unknown[]) {
  let msg = args.map(fmt).join(" ");
  if (msg.length > MAX_MSG) msg = `${msg.slice(0, MAX_MSG)}… (gekürzt)`;
  entries.push({ t: Date.now(), level, msg });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
}

export function installConsoleBuffer(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      push(level, args);
      original(...args);
    };
  }
  window.addEventListener("error", (e) => {
    push("error", [`Uncaught ${e.error ?? e.message}`, e.filename ? `@ ${e.filename}:${e.lineno}:${e.colno}` : ""]);
  });
  window.addEventListener("unhandledrejection", (e) => {
    push("error", ["Unhandled rejection:", e.reason]);
  });
}

export function recordError(error: unknown, context: string): void {
  push("error", [context, error]);
}

/** Snapshot, oldest first. */
export function getLogs(): LogEntry[] {
  return entries.slice();
}
