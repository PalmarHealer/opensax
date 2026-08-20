import { fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { getUserIdForSession } from "$lib/server/sessionStore";
import { clearConfig, loadConfig, publicConfig, saveConfig } from "$lib/server/davinciStore";
import { testDaVinciConnection } from "@lernsax/core";

export const load: PageServerLoad = async ({ locals }) => {
  const c = locals.client!;
  const [profile, signature] = await Promise.all([
    c.profile.get().catch(() => ({} as Record<string, string>)),
    c.mail.getSignature().catch(() => ({ text: "", position_answer: "end", position_forward: "end" } as const)),
  ]);
  const user_id = getUserIdForSession(locals.sessionId);
  return {
    profile,
    signature,
    user: c.whoami(),
    groups: c.groups(),
    davinci: publicConfig(user_id ? loadConfig(user_id) : null),
  };
};

const PROFILE_FIELDS = [
  "firstname", "lastname", "title",
  "phone", "phone_business", "phone_mobile", "fax",
  "street", "zip", "city", "country",
  "company", "department", "position", "homepage",
  "birthday", "skype", "comment",
  "visible",
] as const;
const PROFILE_FLAGS = ["show_phone", "show_email", "show_address", "show_company"] as const;

export const actions: Actions = {
  saveProfile: async ({ locals, request }) => {
    const c = locals.client!;
    const data = await request.formData();
    const patch: Record<string, unknown> = {};
    for (const f of PROFILE_FIELDS) {
      const v = data.get(f);
      if (v !== null) patch[f] = v.toString();
    }
    for (const f of PROFILE_FLAGS) {
      patch[f] = data.get(f) === "1" ? "1" : "0";
    }
    try {
      await c.profile.update(patch);
    } catch (e) { return fail(500, { scope: "profile", error: (e as Error).message }); }
    return { ok: true, scope: "profile" };
  },
  saveSignature: async ({ locals, request }) => {
    const c = locals.client!;
    const data = await request.formData();
    const text = data.get("text")?.toString() ?? "";
    const position_answer = (data.get("position_answer")?.toString() === "start" ? "start" : "end") as "start" | "end";
    const position_forward = (data.get("position_forward")?.toString() === "start" ? "start" : "end") as "start" | "end";
    try {
      await c.mail.setSignature({ text, position_answer, position_forward });
    } catch (e) { return fail(500, { scope: "signature", error: (e as Error).message }); }
    return { ok: true, scope: "signature" };
  },

  saveDavinci: async ({ locals, request }) => {
    const user_id = getUserIdForSession(locals.sessionId);
    if (!user_id) return fail(401, { scope: "davinci", error: "Nicht angemeldet" });

    const data = await request.formData();
    const endpoint = data.get("endpoint")?.toString().trim() ?? "";
    const username = data.get("username")?.toString() ?? "";
    // Usernames are handed out with significant whitespace ("IT 25/3 "), so the
    // field is stored verbatim — trimming it breaks the login outright.
    const existing = loadConfig(user_id);
    const typed = data.get("password")?.toString() ?? "";
    // An untouched password field means "keep what's stored", not "clear it".
    const password = typed || existing?.password || "";

    if (!endpoint) return fail(400, { scope: "davinci", error: "Endpoint fehlt" });

    const cfg = {
      endpoint,
      username,
      password,
      classCode: data.get("classCode")?.toString().trim() || undefined,
      teacherCode: data.get("teacherCode")?.toString().trim() || undefined,
      includeSupervisions: data.get("includeSupervisions") === "1",
    };

    const probe = await testDaVinciConnection(cfg);
    if (!probe.ok) return fail(400, { scope: "davinci", error: probe.error });

    // Store the URL that answered, not the one the user typed: otherwise every
    // later page load re-runs the https attempt and eats a connect timeout.
    saveConfig(user_id, { ...cfg, endpoint: probe.resolvedEndpoint });
    return { ok: true, scope: "davinci", info: probe.info };
  },

  clearDavinci: async ({ locals }) => {
    const user_id = getUserIdForSession(locals.sessionId);
    if (!user_id) return fail(401, { scope: "davinci", error: "Nicht angemeldet" });
    clearConfig(user_id);
    return { ok: true, scope: "davinci-cleared" };
  },
};
