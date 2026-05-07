/**
 * Convert plain text to HTML with linkified URLs and email addresses.
 * Escapes everything else to prevent injection.
 */
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
 * Sanitize an HTML string for safe rendering: drop scripts/iframes/event handlers,
 * force all links to open in a new tab.
 */
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<\s*script\b[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, "")
    .replace(/<\s*iframe\b[^>]*>[\s\S]*?<\s*\/\s*iframe\s*>/gi, "")
    .replace(/<\s*style\b[^>]*>[\s\S]*?<\s*\/\s*style\s*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/<a\b([^>]*?)>/gi, (m, attrs) => {
      // ensure target=_blank + rel
      let cleaned: string = (attrs as string)
        .replace(/\s(target|rel)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
      return `<a${cleaned} target="_blank" rel="noopener noreferrer">`;
    });
}
