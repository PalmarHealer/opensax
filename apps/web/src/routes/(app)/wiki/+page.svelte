<script lang="ts">
  import { enhance } from "$app/forms";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import Icon from "$lib/Icon.svelte";
  import Modal from "$lib/Modal.svelte";
  import { sanitizeHtml } from "$lib/linkify";

  let { data } = $props();
  const groupValue = $derived(data.group ?? "");

  function selectPage(id: string | null) {
    const u = new URL(page.url);
    if (id) u.searchParams.set("page", id); else u.searchParams.delete("page");
    goto(u.pathname + u.search, { invalidateAll: true });
  }

  let creating = $state(false);
  let editing = $state(false);
  let editTitle = $state("");
  let editText = $state("");
  function startEdit() {
    editTitle = data.current?.title ?? "";
    editText = data.current?.text ?? data.current?.content ?? "";
    editing = true;
  }
</script>

<div class="grid h-full grid-cols-1 md:[grid-template-columns:280px_1fr]">
  <!-- Page list: collapsible sheet on mobile via <details>, static rail at md+ -->
  <details class="border-b border-zinc-800 bg-zinc-900/30 md:hidden">
    <summary class="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold">
      <span>{data.current?.title ?? "Wiki"}</span>
      <Icon name="chevron-down" size={16} />
    </summary>
    <nav class="max-h-64 overflow-auto border-t border-zinc-800 p-2">
      {#if data.group}
        <button onclick={() => (creating = true)} class="mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100">
          <Icon name="plus" size={16} /> Neue Seite
        </button>
      {/if}
      {#each data.pages as p}
        <button
          class="block w-full truncate rounded-md px-2 py-1.5 text-left text-sm transition {data.pageId === p.id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-900'}"
          onclick={() => selectPage(p.id)}
        >{p.title}</button>
      {:else}
        <p class="px-2 py-4 text-center text-xs text-zinc-500">Keine Seiten.</p>
      {/each}
    </nav>
  </details>

  <aside class="hidden h-full min-w-0 flex-col border-r border-zinc-800 bg-zinc-900/30 md:flex">
    <div class="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
      <h2 class="text-sm font-semibold">Wiki</h2>
      {#if data.group}
        <button onclick={() => (creating = true)} class="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100" aria-label="Neue Seite"><Icon name="plus" size={16} /></button>
      {/if}
    </div>
    <nav class="flex-1 overflow-auto p-2">
      {#each data.pages as p}
        <button
          class="block w-full truncate rounded-md px-2 py-1.5 text-left text-sm transition {data.pageId === p.id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-900'}"
          onclick={() => selectPage(p.id)}
        >{p.title}</button>
      {:else}
        <p class="px-2 py-4 text-center text-xs text-zinc-500">Keine Seiten.</p>
      {/each}
    </nav>
  </aside>

  <main class="overflow-auto">
    {#if !data.group}
      <p class="p-4 text-center text-sm text-zinc-500 md:p-8">Keine Gruppe gewählt.</p>
    {:else if !data.current}
      <p class="p-4 text-center text-sm text-zinc-500 md:p-8">Seite auswählen oder erstellen.</p>
    {:else}
      <article class="mx-auto max-w-3xl p-4 md:p-8">
        <header class="mb-4 flex items-start justify-between gap-3">
          <h1 class="text-2xl font-semibold">{data.current.title}</h1>
          <div class="flex gap-1">
            <button onclick={startEdit} class="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100" aria-label="Bearbeiten"><Icon name="pencil" size={16} /></button>
            <form method="POST" action="?/remove" use:enhance={() => async ({ update }) => { await update(); selectPage(null); }}>
              <input type="hidden" name="group" value={groupValue} />
              <input type="hidden" name="id" value={data.current.id} />
              <button class="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-red-400" aria-label="Löschen"><Icon name="trash" size={16} /></button>
            </form>
          </div>
        </header>
        <div class="prose prose-invert prose-sm max-w-none break-words leading-relaxed">
          {@html sanitizeHtml(data.current.text ?? data.current.content ?? "")}
        </div>
      </article>
    {/if}
  </main>
</div>

<Modal open={creating} onclose={() => (creating = false)} title="Neue Wiki-Seite">
  <form method="POST" action="?/create" use:enhance={() => async ({ update }) => { await update(); creating = false; }} class="space-y-3">
    <input type="hidden" name="group" value={groupValue} />
    <input name="title" placeholder="Titel" required class="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm font-semibold outline-none focus:border-indigo-500" />
    <textarea name="text" placeholder="Inhalt (HTML)…" rows="8" class="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-indigo-500"></textarea>
    <div class="flex justify-end gap-2 pt-1">
      <button type="button" onclick={() => (creating = false)} class="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-100">Abbrechen</button>
      <button type="submit" class="rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium hover:bg-indigo-400">Anlegen</button>
    </div>
  </form>
</Modal>

<Modal open={editing} onclose={() => (editing = false)} title="Seite bearbeiten">
  <form method="POST" action="?/update" use:enhance={() => async ({ update }) => { await update(); editing = false; }} class="space-y-3">
    <input type="hidden" name="group" value={groupValue} />
    <input type="hidden" name="id" value={data.current?.id ?? ""} />
    <input name="title" bind:value={editTitle} placeholder="Titel" required class="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm font-semibold outline-none focus:border-indigo-500" />
    <textarea name="text" bind:value={editText} placeholder="Inhalt (HTML)…" rows="12" class="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-indigo-500"></textarea>
    <div class="flex justify-end gap-2 pt-1">
      <button type="button" onclick={() => (editing = false)} class="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-100">Abbrechen</button>
      <button type="submit" class="rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium hover:bg-indigo-400">Speichern</button>
    </div>
  </form>
</Modal>
