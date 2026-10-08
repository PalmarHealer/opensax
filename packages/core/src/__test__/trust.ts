import { JsonRpcTransport, LernSaxSession } from "../index.js";

// Checks the 2FA re-login path against a real account: registers an auth
// token with a password login (what a TOTP login does), logs in with only that
// token, then deletes it again. Prints the shape of register_master's reply,
// never the token itself.
const email = process.env.LERNSAX_EMAIL!;
const password = process.env.LERNSAX_PASSWORD!;

const rpc = new JsonRpcTransport();
const [, , reg] = await rpc.batchOk([
  { method: "login", params: { login: email, password, application: "opensax", get_miniature: false } },
  { method: "set_focus", params: { object: "trusts" } },
  { method: "register_master", params: { remote_application: "opensax", remote_title: "OpenSax (Test)", unregister_on_password_change: true } },
  { method: "get_information", params: {} },
]);
const shape = JSON.stringify(reg, (_k, v) => (typeof v === "string" ? `<string ${v.length}>` : v));
console.log("register_master reply:", shape);
const trust = reg?.trust as Record<string, unknown> | undefined;
const token = [trust?.token, reg?.token, trust?.key, reg?.key].find((v): v is string => typeof v === "string" && !!v);
if (!token) {
  console.error("FAIL: no token found in the reply");
  process.exit(1);
}

const s = new LernSaxSession({ email, password: "", trustToken: token });
try {
  await s.ensureSession();
  console.log("OK token login as", s.whoami?.name_hr ?? s.whoami?.login);
} catch (err) {
  console.error("FAIL token login:", err);
  process.exitCode = 1;
} finally {
  await s.revokeTrust();
  await s.logout();
}
