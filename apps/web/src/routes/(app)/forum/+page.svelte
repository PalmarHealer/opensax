<script lang="ts">
  import { enhance } from "$app/forms";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import Icon from "$lib/Icon.svelte";
  import Modal from "$lib/Modal.svelte";
  import PersonChip from "$lib/PersonChip.svelte";
  import { sanitizeHtml, linkifyPlain } from "$lib/linkify";

  let { data } = $props();
  const groupValue = $derived(data.group ?? "");

  function fmt(ts: number | { date?: number } | undefined): string {
    if (!ts) return "";
    const n = typeof ts === "object" ? Number(ts.date) : Number(ts);
    if (!Number.isFinite(n) || n <= 0) return "";
    return new Date(n * 1000).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
  }
  function authorName(e: any): string {
    return e?.created?.user?.name_hr ?? e?.created?.user?.login ?? e?.author?.name_hr ?? e?.author?.login ?? "—";
  }
  function looksHtml(s: string): boolean { return /<[a-z][\s\S]*>/i.test(s); }
  function openThread(id: string | null) {
    const u = new URL(page.url);
    if (id) u.searchParams.set("thread", id); else u.searchParams.delete("thread");
    goto(u.pathname + u.search, { invalidateAll: true });
  }

  let composing = $state(false);
  let replying = $state(false);
</script>

<div class="grid h-full" style="grid-template-rows: auto 1fr">
  <header class="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-950/80 px-6 py-3">
    <div class="flex items-center gap-3">
      {#if data.thread}
        <button class="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100" onclick={() => openThread(null)} aria-label="Zurück">
          <Icon name="arrow-left" size={18} />
        </button>
      {/if}
      <h1 class="text-lg font-semibold tracking-tight">Forum</h1>
    </div>
    {#if data.group && !data.thread}
      <button onclick={() => (composing = true)} class="flex items-center gap-1.5 rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-400">
        <Icon name="plus" size={16} /> Thema
      </button>
    {:else if data.group && data.thread}
      <button onclick={() => (replying = true)} class="flex items-center gap-1.5 rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-400">
        <Icon name="message-2" size={16} /> Antworten
      </button>
    {/if}
  </header>

  <section class="overflow-auto px-6 py-6">
    {#if !data.group}
      <p class="text-center text-sm text-zinc-500">Keine Gruppe gewählt.</p>
    {:else if data.thread && data.root}
      <div class="mx-auto max-w-3xl space-y-3">
        <article class="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5">
          <h2 class="text-lg font-semibold">{data.root.title}</h2>
          <p class="mt-1 text-xs text-zinc-500">
            <span class="font-medium text-zinc-400">{authorName(data.root)}</span>
            <span> · {fmt(data.root.created)}</span>
          </p>
          {#if looksHtml(data.root.text ?? "")}
            <div class="prose prose-invert prose-sm mt-3 max-w-none break-words leading-relaxed">{@html sanitizeHtml(data.root.text ?? "")}</div>
          {:else}
            <div class="mt-3 break-words text-sm leading-relaxed text-zinc-200">{@html linkifyPlain(data.root.text ?? "")}</div>
          {/if}
        </article>
        {#each data.replies as r}
          {#if r.id !== data.thread}
            <article class="ml-6 rounded-xl border border-zinc-800 bg-zinc-900/20 p-4">
              <p class="text-xs text-zinc-500">
                <span class="font-medium text-zinc-400">{authorName(r)}</span>
                <span> · {fmt(r.created)}</span>
              </p>
              {#if looksHtml(r.text ?? "")}
                <div class="prose prose-invert prose-sm mt-2 max-w-none break-words leading-relaxed">{@html sanitizeHtml(r.text ?? "")}</div>
              {:else}
                <div class="mt-2 break-words text-sm leading-relaxed text-zinc-200">{@html linkifyPlain(r.text ?? "")}</div>
              {/if}
            </article>
          {/if}
        {:else}
          <p class="py-6 text-center text-sm text-zinc-500">Noch keine Antworten.</p>
        {/each}
      </div>
    {:else}
      <div class="mx-auto max-w-3xl space-y-2">
        {#each data.threads as t}
          <button
            class="group flex w-full items-start justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/30 p-4 text-left transition hover:bg-zinc-900/60"
            onclick={() => openThread(t.id)}
          >
            <div class="min-w-0 flex-1">
              <h2 class="truncate text-sm font-semibold">{t.title}</h2>
              <p class="mt-1 truncate text-xs text-zinc-500">
                <span class="text-zinc-400"><PersonChip name={(t as any)?.created?.user?.name_hr ?? (t as any)?.author?.name_hr} login={(t as any)?.created?.user?.login ?? (t as any)?.author?.login} /></span>
                <span> · {fmt(t.created)}</span>
                {#if t.reply_count}<span> · {t.reply_count} Antworten</span>{/if}
              </p>
            </div>
            <Icon name="chevron-right" size={16} />
          </button>
        {:else}
          <p class="py-12 text-center text-sm text-zinc-500">Keine Themen.</p>
        {/each}
      </div>
    {/if}
  </section>
</div>

<Modal open={composing} onclose={() => (composing = false)} title="Neues Thema">
  <form method="POST" action="?/post" use:enhance={() => async ({ update }) => { await update(); composing = false; }} class="space-y-3">
    <input type="hidden" name="group" value={groupValue} />
    <input name="title" placeholder="Titel" required class="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm font-semibold outline-none focus:border-indigo-500" />
    <textarea name="text" placeholder="Text…" required rows="6" class="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-indigo-500"></textarea>
    <div class="flex justify-end gap-2 pt-1">
      <button type="button" onclick={() => (composing = false)} class="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-100">Abbrechen</button>
      <button type="submit" class="rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium hover:bg-indigo-400">Posten</button>
    </div>
  </form>
</Modal>

<Modal open={replying} onclose={() => (replying = false)} title="Antworten">
  <form method="POST" action="?/post" use:enhance={() => async ({ update }) => { await update(); replying = false; }} class="space-y-3">
    <input type="hidden" name="group" value={groupValue} />
    <input type="hidden" name="parent_id" value={data.thread ?? ""} />
    <input name="title" placeholder="Titel (optional)" value={data.root ? `Re: ${data.root.title}` : ""} class="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm font-semibold outline-none focus:border-indigo-500" />
    <textarea name="text" placeholder="Antwort…" required rows="5" class="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-indigo-500"></textarea>
    <div class="flex justify-end gap-2 pt-1">
      <button type="button" onclick={() => (replying = false)} class="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-100">Abbrechen</button>
      <button type="submit" class="rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium hover:bg-indigo-400">Senden</button>
    </div>
  </form>
</Modal>
