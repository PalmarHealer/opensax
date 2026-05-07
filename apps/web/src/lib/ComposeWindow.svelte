<script lang="ts">
  import Icon from "$lib/Icon.svelte";
  import { composeStore } from "$lib/composeStore.svelte";

  let busy = $state(false);
  let error = $state<string | null>(null);

  async function send(e: SubmitEvent) {
    e.preventDefault();
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
      composeStore.close();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

{#if composeStore.open}
  <div class="fixed bottom-0 right-6 z-50 flex flex-col rounded-t-2xl border border-zinc-800 bg-zinc-950 shadow-2xl
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
          onclick={() => composeStore.close()}
          class="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-red-400"
          title="Schließen"
          aria-label="Schließen"
        ><Icon name="x" size={14} /></button>
      </div>
    </header>

    {#if !composeStore.minimized}
      <form onsubmit={send} class="flex flex-1 flex-col overflow-hidden">
        <div class="flex flex-col gap-1 border-b border-zinc-800 px-3 py-2">
          <label class="flex items-center gap-2 text-sm">
            <span class="w-12 shrink-0 text-xs text-zinc-500">An</span>
            <input
              type="text"
              required
              bind:value={composeStore.draft.to}
              class="flex-1 bg-transparent outline-none placeholder:text-zinc-600"
              placeholder="empfaenger@…"
            />
          </label>
          <label class="flex items-center gap-2 text-sm">
            <span class="w-12 shrink-0 text-xs text-zinc-500">CC</span>
            <input
              type="text"
              bind:value={composeStore.draft.cc}
              class="flex-1 bg-transparent outline-none placeholder:text-zinc-600"
            />
          </label>
          <label class="flex items-center gap-2 text-sm">
            <span class="w-12 shrink-0 text-xs text-zinc-500">BCC</span>
            <input
              type="text"
              bind:value={composeStore.draft.bcc}
              class="flex-1 bg-transparent outline-none placeholder:text-zinc-600"
            />
          </label>
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
          <button
            type="button"
            onclick={() => composeStore.close()}
            class="rounded p-1.5 text-zinc-500 hover:bg-zinc-900 hover:text-red-400"
            title="Verwerfen"
            aria-label="Verwerfen"
          ><Icon name="trash" size={14} /></button>
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
