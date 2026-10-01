/**
 * REST API end-to-end against a throwaway data dir: real token and session
 * files on disk, a fake LernSax client behind the session cache.
 *
 * Run with `pnpm --filter @lernsax/mcp test`.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCipheriv, createHash, randomBytes } from "node:crypto";

const dir = mkdtempSync(join(tmpdir(), "opensax-rest-"));
const KEY = "k".repeat(32);
process.env.LERNSAX_DATA_DIR = dir;
process.env.LERNSAX_WEB_SESSION_KEY = KEY;
process.env.LERNSAX_API_RATE_PER_MIN = "1000";
process.env.LERNSAX_API_AUTH_FAIL_PER_MIN = "20";
delete process.env.WEB_ORIGIN;

const EMAIL = "ada@example.org";
const userId = createHash("sha256").update(EMAIL).digest("hex").slice(0, 32);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function writeSession() {
  mkdirSync(join(dir, "sessions"), { recursive: true });
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(KEY), iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify({ email: EMAIL, password: "pw" })), cipher.final()]);
  writeFileSync(join(dir, "sessions", "dev1.json"), JSON.stringify({
    user_id: userId, encCreds: enc.toString("hex"), iv: iv.toString("hex"), tag: cipher.getAuthTag().toString("hex"),
    createdAt: Date.now(), lastSeen: Date.now(),
  }));
}

function writeToken(id: string, token: string, scopes: string[], expires_at = 0) {
  mkdirSync(join(dir, "connections"), { recursive: true });
  writeFileSync(join(dir, "connections", `${id}.json`), JSON.stringify({
    id, token_hash: sha(token), user_id: userId, client_id: "opensax-api-token", client_name: `Token ${id}`,
    redirect_uris: [], scopes, created_at: Date.now(), last_used_at: 0, expires_at, kind: "token",
  }));
}

const calls: unknown[] = [];
const fakeClient = {
  whoami: () => ({ login: EMAIL }),
  groups: () => [],
  mail: {
    getFolders: async () => [{ id: "INBOX" }],
    getMessages: async (args: unknown) => { calls.push(args); return [{ id: "1" }]; },
  },
  files: {
    download: async () => ({ name: "Bericht ä.pdf", size: 3, data: new Uint8Array([1, 2, 3]) }),
    downloadUrl: async () => "https://example.invalid/x",
  },
};
const fakeCache = { get: async () => fakeClient } as never;

let server: Server;
let base = "";

before(async () => {
  writeSession();
  writeToken("full", "tok-full", ["lernsax"]);
  writeToken("mail", "tok-mail", ["mail_list", "mail_folders"]);
  writeToken("old", "tok-old", ["lernsax"], Date.now() - 1000);
  writeToken("oidc", "tok-oidc", ["openid", "profile"]);
  const { handleRest } = await import("./rest.js");
  server = createServer(async (req, res) => {
    if (!(await handleRest(req, res, fakeCache))) { res.statusCode = 404; res.end(); }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/api/v1`;
});

after(() => {
  server?.close();
  rmSync(dir, { recursive: true, force: true });
});

const call = (path: string, token?: string, body?: unknown, method = body === undefined ? "GET" : "POST") =>
  fetch(`${base}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

test("openapi.json is public and lists every tool", async () => {
  const { TOOLS } = await import("./tools.js");
  const r = await call("/openapi.json");
  assert.equal(r.status, 200);
  const spec = await r.json() as { paths: Record<string, { post?: { requestBody: { content: { "application/json": { schema: { required?: string[] } } } } } }> };
  for (const t of TOOLS) assert.ok(spec.paths[`/${t.name}`], t.name);
  assert.deepEqual(spec.paths["/mail_read"]!.post!.requestBody.content["application/json"].schema.required, ["folder_id", "message_id"]);
});

test("rejects missing, unknown, expired and sign-in-only tokens", async () => {
  assert.equal((await call("/mail_folders", undefined, {})).status, 401);
  assert.equal((await call("/mail_folders", "nope", {})).status, 401);
  const expired = await call("/mail_folders", "tok-old", {});
  assert.equal(expired.status, 401);
  assert.equal(((await expired.json()) as { error: { code: string } }).error.code, "token_expired");
  assert.equal((await call("/mail_folders", "tok-oidc", {})).status, 403);
});

test("per-tool scopes: allowed tool runs, others are 403", async () => {
  const okRes = await call("/mail_list", "tok-mail", { folder_id: "INBOX", limit: 5 });
  assert.equal(okRes.status, 200);
  assert.deepEqual(await okRes.json(), [{ id: "1" }]);
  assert.deepEqual(calls.at(-1), { folder_id: "INBOX", limit: 5 });

  const denied = await call("/whoami", "tok-mail", {});
  assert.equal(denied.status, 403);
  assert.equal(((await denied.json()) as { error: { code: string } }).error.code, "insufficient_scope");

  const list = await (await call("/tools", "tok-mail")).json() as { tools: string[]; token: { kind: string } };
  assert.deepEqual(list.tools.sort(), ["mail_folders", "mail_list"]);
  assert.equal(list.token.kind, "token");
});

test("validates arguments against the tool schema", async () => {
  const missing = await call("/mail_list", "tok-full", {});
  assert.equal(missing.status, 400);
  const extra = await call("/mail_folders", "tok-full", { bogus: 1 });
  assert.equal(extra.status, 400);
  const wrongType = await call("/mail_list", "tok-full", { folder_id: "INBOX", limit: "5" });
  assert.equal(wrongType.status, 400);
  assert.equal((await call("/mail_folders", "tok-full", undefined, "POST")).status, 200);
});

test("unknown tool is 404, GET on a tool is 405", async () => {
  assert.equal((await call("/does_not_exist", "tok-full", {})).status, 404);
  assert.equal((await call("/mail_folders", "tok-full")).status, 405);
});

test("files_download answers with the raw file", async () => {
  const r = await call("/files_download", "tok-full", { id: "f1" });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "application/pdf");
  assert.match(r.headers.get("content-disposition") ?? "", /Bericht%20%C3%A4\.pdf/);
  assert.deepEqual([...new Uint8Array(await r.arrayBuffer())], [1, 2, 3]);
});

test("timetable without config explains itself", async () => {
  const r = await call("/timetable_info", "tok-full", {});
  assert.equal(r.status, 409);
  assert.equal(((await r.json()) as { error: { code: string } }).error.code, "not_configured");
});

test("token stops working once no device session is left", async () => {
  rmSync(join(dir, "sessions"), { recursive: true, force: true });
  const r = await call("/mail_folders", "tok-full", {});
  assert.equal(r.status, 401);
  assert.equal(((await r.json()) as { error: { code: string } }).error.code, "no_session");
  writeSession();
});

test("MCP server registers only the granted tools", async () => {
  const { buildServer } = await import("./server.js");
  const { server: mcp } = buildServer(fakeCache, { email: EMAIL, password: "pw" }, new Set(["mail_list"]));
  const registered = Object.keys((mcp as unknown as { _registeredTools: Record<string, unknown> })._registeredTools);
  assert.deepEqual(registered, ["mail_list"]);
});

test("random bearers can't dodge the rate limit", async () => {
  const from = (ip: string, token: string) =>
    fetch(`${base}/mail_folders`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-forwarded-for": ip },
      body: "{}",
    });
  for (let i = 0; i < 20; i++) assert.equal((await from("203.0.113.9", `random-${i}`)).status, 401);
  const blocked = await from("203.0.113.9", "random-20");
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  // Other clients are unaffected.
  assert.equal((await from("203.0.113.10", "tok-full")).status, 200);
});
