import { fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const c = locals.client!;
  const [profile, signature] = await Promise.all([
    c.profile.get().catch(() => ({} as Record<string, string>)),
    c.mail.getSignature().catch(() => ({ text: "", position_answer: "end", position_forward: "end" } as const)),
  ]);
  return {
    profile,
    signature,
    user: c.whoami(),
    groups: c.groups(),
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
    } catch (e) { return fail(500, { error: (e as Error).message }); }
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
    } catch (e) { return fail(500, { error: (e as Error).message }); }
    return { ok: true, scope: "signature" };
  },
};
