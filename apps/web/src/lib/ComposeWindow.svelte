<script lang="ts">
  import Icon from "$lib/Icon.svelte";
  import { composeStore } from "$lib/composeStore.svelte";
  import RecipientPicker from "$lib/RecipientPicker.svelte";
  import { invalidate } from "$app/navigation";

  let busy = $state(false);
  let error = $state<string | null>(null);
  let savedNote = $state(false);
  let saving = false; // in-flight guard for autosave/save-on-close

  async function saveDraft(): Promise<void> {
    // Never persist an empty draft, and never overlap with an in-flight save.
    if (saving || !composeStore.isNonEmpty()) return;
    saving = true;
    try {
      const d = composeStore.draft;
      const res = await fetch("/api/mail/save-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: d.to,
          cc: d.cc,
          bcc: d.bcc,
          subject: d.subject,
          body: d.body,
          prevId: d.draftId,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        draftId?: string;
        error?: string;
      };
      if (!res.ok) {
        error = body.error ?? `HTTP ${res.status}`;
        return;
      }
      // Retain the new draft's id so the next save deletes this version
      // (LernSax save_draft can't update, only create) — avoids duplicates.
      composeStore.setDraftId(body.draftId);
      savedNote = true;
      await invalidate("mail:list");
    } catch (err) {
      error = (err as Error).message;
    } finally {
      saving = false;
    }
  }

  // Debounced autosave: persist ~3s after the last edit to any draft field.
  let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    // Track the fields so the effect re-runs on every edit.
    const d = composeStore.draft;
    void d.to;
    void d.cc;
    void d.bcc;
    void d.subject;
    void d.body;
    savedNote = false;
    if (!composeStore.isNonEmpty()) return;
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      void saveDraft();
    }, 5000);
    return () => clearTimeout(autosaveTimer);
  });

  async function saveAndClose() {
    clearTimeout(autosaveTimer);
    await saveDraft();
    composeStore.close();
  }

  async function discard() {
    clearTimeout(autosaveTimer);
    // If autosave already persisted a draft, remove it from the Drafts folder.
    const id = composeStore.draft.draftId;
    if (id) {
      try {
        await fetch("/api/mail/save-draft", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        await invalidate("mail:list");
      } catch {
        /* best-effort cleanup */
      }
    }
    composeStore.discard();
  }

  async function send(e: SubmitEvent) {
    e.preventDefault();
    if (!composeStore.draft.to.trim()) {
      error = "Empfänger fehlt.";
      return;
    }
    busy = true;
    error = null;
    try {
      const fd = new FormData();
      fd.set("to", composeStore.draft.to);
      fd.set("cc", composeStore.draft.cc);
      fd.set("bcc", composeStore.draft.bcc);
      fd.set("subject", composeStore.draft.subject);
      fd.set("body", composeStore.draft.body);
      if (composeStore.draft.reply_id) fd.set("reply_id", composeStore.draft.reply_id);
      if (composeStore.draft.forward_id) fd.set("forward_id", composeStore.draft.forward_id);

      const res = await fetch("/api/mail/send", { method: "POST", body: fd });
      const ok = res.ok;
      const body = await res.json().catch(() => ({}));
      if (!ok) {
        error = (body as { error?: string }).error ?? `HTTP ${res.status}`;
        return;
      }
      clearTimeout(autosaveTimer);
      // If we were editing/autosaving a draft, remove it from Drafts now that
      // the mail has actually been sent.
      const draftId = composeStore.draft.draftId;
      if (draftId) {
        try {
          await fetch("/api/mail/save-draft", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: draftId }),
          });
        } catch {
          /* best-effort cleanup */
        }
      }
      await invalidate("mail:list");
      composeStore.close();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

{#if composeStore.open}
  <div class="fixed bottom-0 right-2 z-50 flex max-w-[calc(100vw-1rem)] flex-col rounded-t-2xl border border-zinc-800 bg-zinc-950 pb-[env(safe-area-inset-bottom)] shadow-2xl md:right-6
    {composeStore.minimized ? 'w-72 h-10' : 'w-[min(560px,calc(100vw-2rem))] h-[min(640px,calc(100vh-2rem))]'}">
    <header class="flex items-center justify-between gap-2 border-b border-zinc-800 px-3 py-2">
      <p class="truncate text-sm font-medium">
        {composeStore.draft.subject || (composeStore.draft.reply_id ? "Antworten" : composeStore.draft.forward_id ? "Weiterleiten" : "Neue Mail")}
      </p>
      <div class="flex items-center gap-1">
        <button
          onclick={() => composeStore.toggleMinimize()}
          class="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          title={composeStore.minimized ? "Maximieren" : "Minimieren"}
          aria-label={composeStore.minimized ? "Maximieren" : "Minimieren"}
        ><Icon name={composeStore.minimized ? "chevron-down" : "chevron-down"} size={14} class={composeStore.minimized ? "rotate-180" : ""} /></button>
        <button
          onclick={saveAndClose}
          class="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-red-400"
          title="Schließen"
          aria-label="Schließen"
        ><Icon name="x" size={14} /></button>
      </div>
    </header>

    {#if !composeStore.minimized}
      <form onsubmit={send} class="flex flex-1 flex-col overflow-hidden">
        <div class="flex flex-col gap-1 border-b border-zinc-800 px-3 py-2">
          <div class="flex items-center gap-2 text-sm">
            <span class="w-12 shrink-0 text-xs text-zinc-500">An</span>
            <RecipientPicker bind:value={composeStore.draft.to} placeholder="empfaenger@…" />
          </div>
          <div class="flex items-center gap-2 text-sm">
            <span class="w-12 shrink-0 text-xs text-zinc-500">CC</span>
            <RecipientPicker bind:value={composeStore.draft.cc} />
          </div>
          <div class="flex items-center gap-2 text-sm">
            <span class="w-12 shrink-0 text-xs text-zinc-500">BCC</span>
            <RecipientPicker bind:value={composeStore.draft.bcc} />
          </div>
          <label class="flex items-center gap-2 text-sm">
            <span class="w-12 shrink-0 text-xs text-zinc-500">Betreff</span>
            <input
              type="text"
              required
              bind:value={composeStore.draft.subject}
              class="flex-1 bg-transparent outline-none placeholder:text-zinc-600"
            />
          </label>
        </div>
        <textarea
          bind:value={composeStore.draft.body}
          class="flex-1 resize-none bg-transparent px-3 py-2 text-sm leading-relaxed outline-none placeholder:text-zinc-600"
          placeholder="Schreib was…"
        ></textarea>

        {#if error}
          <p class="mx-3 mb-2 rounded-md bg-red-500/10 px-3 py-1.5 text-xs text-red-400">{error}</p>
        {/if}

        <footer class="flex items-center justify-between border-t border-zinc-800 px-3 py-2">
          <div class="flex items-center gap-2">
            <button
              type="button"
              onclick={discard}
              class="rounded p-1.5 text-zinc-500 hover:bg-zinc-900 hover:text-red-400"
              title="Verwerfen"
              aria-label="Verwerfen"
            ><Icon name="trash" size={14} /></button>
            {#if savedNote}
              <span class="text-xs text-zinc-500">Entwurf gespeichert</span>
            {/if}
          </div>
          <button
            type="submit"
            disabled={busy}
            class="flex items-center gap-1.5 rounded-md bg-indigo-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
          >
            {busy ? "Sende…" : "Senden"}
            {#if !busy}<Icon name="send" size={14} />{/if}
          </button>
        </footer>
      </form>
    {/if}
  </div>
{/if}
