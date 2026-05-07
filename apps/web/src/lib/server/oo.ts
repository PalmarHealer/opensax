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

const SECRET = (process.env.ONLYOFFICE_JWT_SECRET ?? "936670e94645ed8a6abd0fb83ed3caa521e1413774b7df86").trim();
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
