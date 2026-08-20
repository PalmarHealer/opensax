<script lang="ts">
  import { page } from "$app/state";
  import { enhance } from "$app/forms";
  import Icon from "$lib/Icon.svelte";
  import Modal from "$lib/Modal.svelte";
  import { composeStore } from "$lib/composeStore.svelte";

  let { data, children } = $props();

  function fmt(ts: number | undefined) {
    if (!ts) return "";
    const d = new Date(ts * 1000);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString("de-DE", { day: "2-digit", month: "short" });
  }
  function folderIcon(f: { is_inbox?: boolean; is_sent?: boolean; is_drafts?: boolean; is_trash?: boolean }): string {
    if (f.is_inbox) return "inbox";
    if (f.is_sent) return "send";
    if (f.is_drafts) return "edit";
    if (f.is_trash) return "trash";
    return "folder";
  }

  // Bulk selection
  let selected = $state(new Set<string>());
  $effect(() => {
    // reset on folder change
    void data.folderId;
    selected = new Set<string>();
  });
  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected = next;
  }
  function selectAll() {
    selected = new Set(data.messages.map((m) => String(m.id)));
  }
  function clearSelection() {
    selected = new Set();
  }
  const selectedArr = $derived([...selected]);

  // Folder management
  let folderModal = $state<null | { mode: "add" } | { mode: "edit"; id: string; name: string }>(null);
  function isSystemFolder(f: { is_inbox?: boolean; is_sent?: boolean; is_drafts?: boolean; is_trash?: boolean }): boolean {
    return Boolean(f.is_inbox || f.is_sent || f.is_drafts || f.is_trash);
  }

  // Mobile master-detail: a message is open when the route has a messageId,
  // i.e. the pathname goes one level deeper than /mail/{folderId}.
  const messageOpen = $derived(/^\/mail\/[^/]+\/[^/]+/.test(page.url.pathname));
  // Mobile folder drawer
  let foldersOpen = $state(false);
  $effect(() => {
    void data.folderId;
    foldersOpen = false;
  });
</script>

<div
  class="grid h-full min-h-0 grid-rows-[minmax(0,1fr)] grid-cols-1 md:[grid-template-columns:240px_380px_1fr]"
>
  <!-- Folder rail: static column at md+, slide-in drawer below md -->
  <!-- Mobile drawer backdrop -->
  {#if foldersOpen}
    <button
      type="button"
      class="fixed inset-0 z-30 bg-black/50 md:hidden"
      onclick={() => (foldersOpen = false)}
      aria-label="Schließen"
    ></button>
  {/if}
  <aside
    class="flex h-full min-h-0 flex-col overflow-auto border-r border-zinc-800 bg-zinc-900/30 px-2 py-3
      max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:w-64 max-md:bg-zinc-950 max-md:transition-transform
      {foldersOpen ? 'max-md:translate-x-0' : 'max-md:-translate-x-full'} md:translate-x-0"
  >
    <button
      onclick={() => composeStore.openNew()}
      class="mx-1 mb-3 flex items-center justify-center gap-2 rounded-md bg-indigo-500 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-400"
    >
      <Icon name="pencil" size={16} />
      Verfassen
    </button>
    <div class="flex items-center justify-between px-2 pb-1">
      <p class="text-xs font-medium uppercase tracking-wide text-zinc-500">Ordner</p>
      <button
        onclick={() => (folderModal = { mode: "add" })}
        class="rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
        title="Ordner anlegen"
        aria-label="Ordner anlegen"
      ><Icon name="plus" size={14} /></button>
    </div>
    {#each data.folders as f}
      <div class="group flex items-center">
        <a
          href="/mail?folder={encodeURIComponent(f.id)}"
          class="flex flex-1 items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition
            {data.folderId === f.id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-900'}"
        >
          <span class="flex min-w-0 items-center gap-2">
            <Icon name={folderIcon(f)} size={16} />
            <span class="truncate">{f.name}</span>
          </span>
          {#if f.unread}
            <span class="rounded-full bg-indigo-500/20 px-1.5 text-xs text-indigo-300">{f.unread}</span>
          {/if}
        </a>
        {#if !isSystemFolder(f)}
          <button
            onclick={() => (folderModal = { mode: "edit", id: f.id, name: f.name })}
            class="hidden rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 group-hover:block"
            aria-label="Ordner bearbeiten"
          ><Icon name="pencil" size={12} /></button>
        {/if}
      </div>
    {/each}
  </aside>

  <!-- Message list: full-width on mobile, hidden when a message is open -->
  <section class="h-full min-h-0 min-w-0 flex-col border-r border-zinc-800 md:flex {messageOpen ? 'hidden md:flex' : 'flex'}">
    <!-- Mobile sub-header: open folder drawer -->
    <div class="flex items-center gap-2 border-b border-zinc-800 bg-zinc-950/80 px-4 py-2 md:hidden">
      <button
        onclick={() => (foldersOpen = true)}
        class="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-sm text-zinc-300 hover:bg-zinc-800"
      >
        <Icon name="folder" size={14} /> Ordner
      </button>
      <span class="truncate text-sm font-medium text-zinc-400">
        {data.folders.find((f) => f.id === data.folderId)?.name ?? "Ordner"}
      </span>
    </div>
    <header class="flex items-center justify-between border-b border-zinc-800 bg-zinc-950/80 px-4 py-2.5">
      {#if selected.size > 0}
        <div class="flex items-center gap-2">
          <button onclick={clearSelection} class="rounded p-1 text-zinc-400 hover:bg-zinc-800" aria-label="Auswahl aufheben"><Icon name="x" size={14} /></button>
          <span class="text-sm font-medium">{selected.size} ausgewählt</span>
        </div>
        <div class="flex items-center gap-1">
          <form method="POST" action="/mail?/flagMany" use:enhance={() => async ({ update }) => { await update({ reset: false }); clearSelection(); }} class="contents">
            <input type="hidden" name="folder_id" value={data.folderId} />
            {#each selectedArr as id}<input type="hidden" name="ids" value={id} />{/each}
            <input type="hidden" name="is_unread" value="false" />
            <button class="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100" title="Als gelesen" aria-label="Als gelesen">
              <Icon name="mail" size={14} />
            </button>
          </form>
          <form method="POST" action="/mail?/bulkDelete" use:enhance={() => async ({ update }) => { await update(); clearSelection(); }} class="contents">
            <input type="hidden" name="folder_id" value={data.folderId} />
            {#each selectedArr as id}<input type="hidden" name="ids" value={id} />{/each}
            <button class="rounded p-1.5 text-red-400 hover:bg-red-500/10" title="Löschen" aria-label="Löschen">
              <Icon name="trash" size={14} />
            </button>
          </form>
        </div>
      {:else}
        <div class="flex items-center gap-2 min-w-0">
          <button
            onclick={selectAll}
            class="rounded border border-zinc-700 p-0.5 hover:border-zinc-500"
            title="Alle auswählen"
            aria-label="Alle auswählen"
          ><div class="h-3 w-3"></div></button>
          <h1 class="truncate text-sm font-semibold uppercase tracking-wide text-zinc-400">
            {data.folders.find((f) => f.id === data.folderId)?.name ?? "Ordner"}
          </h1>
        </div>
        <span class="text-xs text-zinc-500">{data.messages.length}</span>
      {/if}
    </header>
    <ul class="flex-1 overflow-auto">
      {#each data.messages as m}
        {@const unread = m.is_unread === 1}
        {@const sender = m.from?.[0]}
        {@const isActive = page.url.pathname === `/mail/${encodeURIComponent(data.folderId)}/${encodeURIComponent(String(m.id))}`}
        {@const isSelected = selected.has(String(m.id))}
        <li class="group/row relative">
          <a
            href="/mail/{encodeURIComponent(data.folderId)}/{encodeURIComponent(String(m.id))}"
            class="flex items-start gap-2 border-b border-zinc-900 px-4 py-3 transition hover:bg-zinc-900/50
              {isActive ? 'bg-zinc-800/60' : isSelected ? 'bg-indigo-500/10' : unread ? 'bg-zinc-900/30' : ''}"
          >
            <button
              type="button"
              onclick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(String(m.id)); }}
              class="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border transition
                {isSelected ? 'border-indigo-500 bg-indigo-500 text-white' : 'border-zinc-700 hover:border-zinc-500'}"
              aria-label="Auswählen"
            >{#if isSelected}<span class="text-[10px]">✓</span>{/if}</button>
            <div class="mt-1.5 h-2 w-2 shrink-0 rounded-full {unread ? 'bg-indigo-400' : 'bg-transparent'}"></div>
            <div class="min-w-0 flex-1">
              <div class="flex items-baseline justify-between gap-2">
                <p class="truncate text-sm {unread ? 'font-semibold' : 'font-medium'}">{sender?.name || sender?.addr || "—"}</p>
                <span class="shrink-0 text-xs text-zinc-500">{fmt(m.date)}</span>
              </div>
              <p class="truncate text-sm {unread ? 'text-zinc-100' : 'text-zinc-400'}">{m.subject ?? "(kein Betreff)"}</p>
              {#if m.preview}
                <p class="line-clamp-1 text-xs text-zinc-500">{m.preview}</p>
              {/if}
            </div>
          </a>
        </li>
      {:else}
        <li class="px-4 py-12 text-center text-sm text-zinc-500">Keine Nachrichten.</li>
      {/each}
    </ul>
  </section>

  <!-- Detail slot: full-width on mobile only when a message is open -->
  <main class="h-full min-w-0 overflow-auto md:block {messageOpen ? 'block' : 'hidden md:block'}">
    {@render children()}
  </main>
</div>

<!-- Folder modal: add/edit/delete -->
<Modal open={folderModal !== null} onclose={() => (folderModal = null)} title={folderModal?.mode === "edit" ? "Ordner bearbeiten" : "Ordner anlegen"}>
  {#if folderModal}
    {#if folderModal.mode === "add"}
      <form
        method="POST"
        action="/mail?/addFolder"
        use:enhance={() => async ({ update }) => { await update(); folderModal = null; }}
        class="space-y-3"
      >
        <label class="block">
          <span class="mb-1 block text-xs font-medium text-zinc-400">Name</span>
          <input name="name" required class="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
        </label>
        <label class="block">
          <span class="mb-1 block text-xs font-medium text-zinc-400">Vorhaltezeit (Tage, 0 = unbegrenzt)</span>
          <input name="expires_days" type="number" min="0" value="0" class="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
        </label>
        <div class="flex justify-end gap-2 pt-1">
          <button type="button" onclick={() => (folderModal = null)} class="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-100">Abbrechen</button>
          <button class="rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium hover:bg-indigo-400">Anlegen</button>
        </div>
      </form>
    {:else}
      <form
        method="POST"
        action="/mail?/renameFolder"
        use:enhance={() => async ({ update }) => { await update(); folderModal = null; }}
        class="space-y-3"
        id="folder-rename-form"
      >
        <input type="hidden" name="folder_id" value={folderModal.id} />
        <label class="block">
          <span class="mb-1 block text-xs font-medium text-zinc-400">Name</span>
          <input name="name" required value={folderModal.name} class="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
        </label>
        <label class="block">
          <span class="mb-1 block text-xs font-medium text-zinc-400">Vorhaltezeit (Tage, 0 = unbegrenzt)</span>
          <input name="expires_days" type="number" min="0" value="0" class="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
        </label>
      </form>
      <form
        method="POST"
        action="/mail?/deleteFolder"
        use:enhance={() => async ({ update }) => { await update(); folderModal = null; }}
        id="folder-delete-form"
      >
        <input type="hidden" name="folder_id" value={folderModal.id} />
      </form>
      <div class="mt-3 flex items-center justify-between">
        <button form="folder-delete-form" type="submit" class="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-sm text-red-300 hover:bg-red-500/20">Löschen</button>
        <div class="flex gap-2">
          <button type="button" onclick={() => (folderModal = null)} class="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-100">Abbrechen</button>
          <button form="folder-rename-form" type="submit" class="rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium hover:bg-indigo-400">Speichern</button>
        </div>
      </div>
    {/if}
  {/if}
</Modal>
