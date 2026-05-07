/**
 * Convert plain text to HTML with linkified URLs and email addresses.
 * Escapes everything else to prevent injection.
 */
import DOMPurify from "isomorphic-dompurify";

const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>"')\]]+)/gi;
const MAIL_RE = /\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function linkifyPlain(text: string): string {
  // Process each line independently so newlines render as <br>.
  const escaped = escape(text);
  return escaped
    .replace(URL_RE, (m) => {
      const href = m.startsWith("http") ? m : `https://${m}`;
      return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="text-indigo-400 underline-offset-2 hover:underline">${m}</a>`;
    })
    .replace(MAIL_RE, (m) => `<a href="mailto:${m}" class="text-indigo-400 underline-offset-2 hover:underline">${m}</a>`)
    .replace(/\r?\n/g, "<br>");
}

/**
 * Sanitize an HTML string for safe rendering. Uses DOMPurify (jsdom on the
 * server, native DOM in the browser) which strips scripts, event handlers,
 * dangerous URLs, mathml/svg trickery, and HTML entity bypasses — none of
 * which our previous regex sanitizer caught.
 *
 * We also force every <a> to `target=_blank rel=noopener noreferrer` via a
 * one-shot afterSanitizeAttributes hook. Hooks are global on the singleton,
 * so we register once at module load.
 */
let hookRegistered = false;
function ensureLinkHook(): void {
  if (hookRegistered) return;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if ((node as Element).tagName === "A") {
      (node as Element).setAttribute("target", "_blank");
      (node as Element).setAttribute("rel", "noopener noreferrer");
    }
  });
  hookRegistered = true;
}

export function sanitizeHtml(html: string): string {
  ensureLinkHook();
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "iframe", "form", "input", "button", "object", "embed", "base"],
    FORBID_ATTR: ["style"],
    ALLOW_DATA_ATTR: false,
  });
}
