import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ url, fetch }) => {
  const mode = url.searchParams.get("mode");
  const folder = url.searchParams.get("folder");
  const message = url.searchParams.get("message");
  if (mode && folder && message) {
    const res = await fetch(`/api/mail/compose-prefill?mode=${encodeURIComponent(mode)}&folder=${encodeURIComponent(folder)}&message=${encodeURIComponent(message)}`);
    if (res.ok) {
      const prefill = (await res.json()) as { to?: string; cc?: string; bcc?: string; subject?: string; body?: string; reply_id?: string; forward_id?: string; draftId?: string };
      return { prefill };
    }
  }
  return { prefill: null };
};
