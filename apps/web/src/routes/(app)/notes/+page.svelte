<script lang="ts">
  import { enhance } from "$app/forms";
  import { page } from "$app/state";
  import Icon from "$lib/Icon.svelte";

  let { data } = $props();
  const groupValue = $derived(data.group ?? "");

  const groups = $derived((page.data.groups as Array<{ login: string; effective_rights?: string[]; member_rights?: string[] }>) ?? []);
  const canWrite = $derived.by(() => {
    if (!data.group) return true;
    const g = groups.find((g) => g.login === data.group);
    if (!g) return false;
    const rights = [...(g.effective_rights ?? []), ...(g.member_rights ?? [])];
    return rights.includes("notes_write") || rights.includes("notes");
  });

  const COLORS = [
    { key: "yellow", bg: "bg-amber-300/15", border: "border-amber-400/40", swatch: "bg-amber-300" },
    { key: "rose", bg: "bg-rose-400/15", border: "border-rose-400/40", swatch: "bg-rose-400" },
    { key: "violet", bg: "bg-violet-400/15", border: "border-violet-400/40", swatch: "bg-violet-400" },
    { key: "sky", bg: "bg-sky-400/15", border: "border-sky-400/40", swatch: "bg-sky-400" },
    { key: "emerald", bg: "bg-emerald-400/15", border: "border-emerald-400/40", swatch: "bg-emerald-400" },
    { key: "zinc", bg: "bg-zinc-700/30", border: "border-zinc-700", swatch: "bg-zinc-500" },
  ];
  function colorOf(key: string | undefined) {
    return COLORS.find((c) => c.key === key) ?? COLORS[5]!;
  }

  let editingId = $state<string | null>(null);
  let composing = $state(false);
  let newColor = $state("yellow");
</script>

<div class="grid h-full" style="grid-template-rows: auto 1fr">
  <header class="flex items-center justify-between border-b border-zinc-800 bg-zinc-950/80 px-6 py-3">
    <h1 class="text-lg font-semibold tracking-tight">Notizen</h1>
    {#if canWrite}
      <button
        onclick={() => (composing = !composing)}
        class="flex items-center gap-1.5 rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-400"
      >
        <Icon name="plus" size={16} /> Notiz
      </button>
    {/if}
  </header>

  <section class="overflow-auto px-6 py-6">
    {#if data.permissionError}
      <div class="mx-auto mb-6 max-w-2xl rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
        Diese Gruppe hat keine Notizen-Berechtigung.
      </div>
    {/if}

    {#if composing && canWrite}
      <form
        method="POST"
        action="?/create"
        use:enhance={() => async ({ update }) => { await update(); composing = false; newColor = "yellow"; }}
        class="mx-auto mb-6 max-w-xl rounded-2xl border {colorOf(newColor).border} {colorOf(newColor).bg} p-4"
      >
        <input type="hidden" name="color" value={newColor} />
        <input type="hidden" name="group" value={groupValue} />
        <input
          name="title"
          placeholder="Titel (optional)"
          class="mb-2 w-full bg-transparent text-base font-semibold outline-none placeholder:text-zinc-500"
        />
        <textarea
          name="text"
          placeholder="Schreib was…"
          rows="4"
          required
          class="w-full resize-none bg-transparent text-sm outline-none placeholder:text-zinc-500"
        ></textarea>
        <div class="mt-3 flex items-center justify-between">
          <div class="flex gap-1.5">
            {#each COLORS as c}
              <button
                type="button"
                onclick={() => (newColor = c.key)}
                class="h-5 w-5 rounded-full {c.swatch} ring-offset-2 ring-offset-zinc-950 {newColor === c.key ? 'ring-2 ring-zinc-300' : ''}"
                aria-label={c.key}
              ></button>
            {/each}
          </div>
          <div class="flex gap-2">
            <button type="button" onclick={() => (composing = false)} class="text-sm text-zinc-500 hover:text-zinc-300">Abbrechen</button>
            <button type="submit" class="rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium hover:bg-indigo-400">Speichern</button>
          </div>
        </div>
      </form>
    {/if}

    {#if data.notes.length === 0 && !composing}
      <div class="grid place-items-center py-24 text-center text-sm text-zinc-500">
        <div>
          <div class="mb-3 inline-grid h-12 w-12 place-items-center rounded-2xl bg-zinc-900 text-zinc-600">
            <Icon name="sticky-note" size={28} />
          </div>
          <p>Noch keine Notizen.</p>
          {#if canWrite}
            <button onclick={() => (composing = true)} class="mt-3 text-sm text-indigo-400 hover:text-indigo-300">Erste anlegen →</button>
          {/if}
        </div>
      </div>
    {:else}
      <div class="grid gap-4" style="grid-template-columns: repeat(auto-fill, minmax(240px, 1fr))">
        {#each data.notes as n}
          {@const col = colorOf(n.color)}
          <article class="group relative break-words rounded-2xl border {col.border} {col.bg} p-4">
            {#if editingId === n.id}
              <form
                method="POST"
                action="?/update"
                use:enhance={() => async ({ update }) => { await update(); editingId = null; }}
              >
                <input type="hidden" name="id" value={n.id} />
                <input type="hidden" name="color" value={n.color ?? "yellow"} />
                <input type="hidden" name="group" value={groupValue} />
                <input
                  name="title"
                  value={n.title ?? ""}
                  class="mb-1 w-full bg-transparent font-semibold outline-none"
                />
                <textarea
                  name="text"
                  rows="6"
                  class="w-full resize-none bg-transparent text-sm outline-none"
                >{n.text}</textarea>
                <div class="mt-2 flex justify-end gap-2">
                  <button type="button" onclick={() => (editingId = null)} class="text-xs text-zinc-500 hover:text-zinc-300">Abbrechen</button>
                  <button type="submit" class="rounded bg-indigo-500 px-2 py-1 text-xs hover:bg-indigo-400">Speichern</button>
                </div>
              </form>
            {:else}
              {#if n.title}
                <h3 class="mb-1 font-semibold">{n.title}</h3>
              {/if}
              <p class="whitespace-pre-wrap text-sm leading-relaxed">{n.text}</p>
              {#if canWrite}
                <div class="absolute right-2 top-2 hidden gap-1 group-hover:flex">
                  <button
                    onclick={() => (editingId = n.id)}
                    class="rounded p-1 text-zinc-500 hover:bg-black/20 hover:text-zinc-200"
                    aria-label="Bearbeiten"
                  ><Icon name="pencil" size={14} /></button>
                  <form method="POST" action="?/remove" use:enhance>
                    <input type="hidden" name="id" value={n.id} />
                    <input type="hidden" name="group" value={groupValue} />
                    <button class="rounded p-1 text-zinc-500 hover:bg-black/20 hover:text-red-400" aria-label="Löschen">
                      <Icon name="trash" size={14} />
                    </button>
                  </form>
                </div>
              {/if}
            {/if}
          </article>
        {/each}
      </div>
    {/if}
  </section>
</div>
