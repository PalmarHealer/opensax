import { LernSaxClient } from "../index.js";

const email = process.env.LERNSAX_EMAIL!;
const password = process.env.LERNSAX_PASSWORD!;

const c = new LernSaxClient({ email, password });
try {
  await c.login();
  console.log("OK login.");
  console.log("user:", c.whoami()?.name_hr ?? c.whoami()?.email);
  console.log("groups:", c.groups().map((g) => `${g.name_hr ?? "?"} <${g.login}>`));
  const folders = await c.mail.getFolders();
  console.log("mail folders:", folders.map((f) => `${f.name} (unread=${f.unread ?? 0})`));
  const inbox = folders.find((f) => f.is_inbox) ?? folders[0];
  if (inbox) {
    const msgs = await c.mail.getMessages({ folder_id: inbox.id, limit: 3 });
    console.log(`first ${msgs.length} mails in ${inbox.name}:`);
    for (const m of msgs) console.log("  -", m.subject, "from", m.from?.[0]?.addr);
  }
} catch (err) {
  console.error("FAIL:", err);
  process.exitCode = 1;
} finally {
  await c.logout();
}
