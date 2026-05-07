import { randomBytes } from "node:crypto";
import { signJwt, verifyJwt } from "./jwt";

export interface OoToken {
  sub: "content" | "callback";
  /** lernsax web session id (our cookie value) */
  sid: string;
  /** lernsax file id, e.g. "/26/744/746" */
  file_id: string;
  /** group login if the file lives in a group, undefined for personal */
  group?: string;
  /** filename (purely for download header) */
  name: string;
}

const SECRET = (() => {
  const env = process.env.ONLYOFFICE_JWT_SECRET?.trim();
  if (env && env.length >= 32) return env;
  if (process.env.NODE_ENV === "production") {
    console.error("[oo] ONLYOFFICE_JWT_SECRET missing or shorter than 32 chars — refusing to start.");
    process.exit(1);
  }
  console.warn("[oo] ONLYOFFICE_JWT_SECRET not set — using ephemeral key. OnlyOffice tokens won't survive restart.");
  return randomBytes(32).toString("hex");
})();
const PUBLIC_URL = (process.env.ONLYOFFICE_PUBLIC_URL ?? "http://localhost:3380").replace(/\/+$/, "");
const WEB_INTERNAL = (process.env.WEB_INTERNAL_URL ?? "http://lernsax-web:3000").replace(/\/+$/, "");

export function ooSecret(): string { return SECRET; }
export function ooPublicUrl(): string { return PUBLIC_URL; }
export function ooApiJsUrl(): string { return `${PUBLIC_URL}/web-apps/apps/api/documents/api.js`; }

/** Build a URL the OO DocumentServer can hit from inside the docker network. */
export function ooInternalUrl(path: string): string {
  return `${WEB_INTERNAL}${path.startsWith("/") ? path : `/${path}`}`;
}

export function ooMintToken(t: OoToken, ttlSec = 6 * 3600): string {
  return signJwt(t as unknown as Record<string, unknown>, SECRET, ttlSec);
}
export function ooVerifyToken(token: string): OoToken | null {
  return verifyJwt<OoToken>(token, SECRET);
}

/** Document type from filename for OnlyOffice. */
export function ooDocumentType(name: string): "word" | "cell" | "slide" {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (["xlsx", "xls", "ods", "csv"].includes(ext)) return "cell";
  if (["pptx", "ppt", "odp"].includes(ext)) return "slide";
  return "word";
}
export function ooFileType(name: string): string {
  return name.toLowerCase().split(".").pop() ?? "docx";
}
