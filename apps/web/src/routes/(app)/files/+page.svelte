<script lang="ts">
  import { enhance } from "$app/forms";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import Icon from "$lib/Icon.svelte";
  import Modal from "$lib/Modal.svelte";
  import PersonChip from "$lib/PersonChip.svelte";

  type Entry = (typeof data.children)[number];

  // Single shared context menu for the files list. Triggered both by the
  // three-dot icon (click → anchor below button) and by right-click on the
  // row (open at cursor).
  let menu = $state<{ entry: Entry; x: number; y: number } | null>(null);
  function openMenuFor(entry: Entry, ev: MouseEvent | { clientX: number; clientY: number }, atCursor: boolean) {
    if (atCursor) {
      menu = { entry, x: ev.clientX, y: ev.clientY };
    } else {
      const rect = (ev as MouseEvent).currentTarget instanceof Element
        ? ((ev as MouseEvent).currentTarget as Element).getBoundingClientRect()
        : null;
      menu = { entry, x: rect ? rect.right - 176 : ev.clientX, y: rect ? rect.bottom + 4 : ev.clientY };
    }
  }
  function closeMenu() { menu = null; }
  $effect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => {
      const el = document.getElementById("files-context-menu");
      if (!el || !el.contains(e.target as Node)) menu = null;
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") menu = null; };
    document.addEventListener("mousedown", onDoc, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc, true);
      document.removeEventListener("keydown", onKey);
    };
  });

  let { data } = $props();

  function fmtSize(bytes?: number): string {
    if (!bytes) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  function fmtDate(ts: number | undefined): string {
    if (!ts) return "—";
    const d = new Date(ts * 1000);
    return d.toLocaleString("de-DE", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  // ── Sorting ─────────────────────────────────────────────────────────
  type SortKey = "name" | "modified" | "size";
  let sortBy = $state<SortKey>("name");
  let sortDir = $state<"asc" | "desc">("asc");
  function toggleSort(k: SortKey) {
    if (sortBy === k) sortDir = sortDir === "asc" ? "desc" : "asc";
    else { sortBy = k; sortDir = k === "name" ? "asc" : "desc"; }
  }
  const sortedChildren = $derived.by(() => {
    const items = [...data.children];
    items.sort((a, b) => {
      // Folders always first.
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      let cmp = 0;
      if (sortBy === "name") cmp = a.name.localeCompare(b.name, "de", { sensitivity: "base", numeric: true });
      else if (sortBy === "modified") cmp = (a.modified?.date ?? 0) - (b.modified?.date ?? 0);
      else if (sortBy === "size") {
        const sa = a.type === "folder" ? a.aggregation?.size ?? 0 : a.size ?? 0;
        const sb = b.type === "folder" ? b.aggregation?.size ?? 0 : b.size ?? 0;
        cmp = sa - sb;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return items;
  });

  // ── Versions panel ──────────────────────────────────────────────────
  // We store only the *identity* of the row; the panel derives the live entry
  // from `data.children` so version deletes (or other writes) re-render the
  // sidebar without manual refresh.
  let versionsKey = $state<{ parent_id: string; name: string } | null>(null);
  const versionsFor = $derived.by(() => {
    if (!versionsKey) return null;
    return sortedChildren.find((c) => c.parent_id === versionsKey!.parent_id && c.name === versionsKey!.name) ?? null;
  });
  // Close on folder navigation, OR when there's no longer a meaningful
  // version history (≤1 variant left). Mid-list deletions keep the panel
  // open so the user can keep working through the list.
  let lastFolderId = $state(data.folderId);
  $effect(() => {
    if (data.folderId !== lastFolderId) {
      versionsKey = null;
      lastFolderId = data.folderId;
    }
  });
  $effect(() => {
    if (versionsKey && (!versionsFor || (versionsFor.versions?.length ?? 0) <= 1)) {
      versionsKey = null;
    }
  });

  let busy = $state(false);
  function navTo(folderId: string) {
    busy = true;
    const u = new URL(page.url);
    u.searchParams.set("folder", folderId);
    u.searchParams.delete("file");
    goto(u.pathname + u.search).finally(() => (busy = false));
  }
  function navToFile(id: string, parentId: string) {
    const u = new URL(page.url);
    u.searchParams.set("folder", parentId);
    u.searchParams.set("file", id);
    goto(u.pathname + u.search);
  }

  const groupValue = $derived(data.group ?? "");

  function rowCanModify(e: { effective?: { modify?: number; delete?: number } }): boolean {
    return Boolean(e.effective?.modify || e.effective?.delete);
  }
  function rowCanRead(e: { effective?: { read?: number }; readable?: number }): boolean {
    // `effective.read` is the authoritative permission once group/role chains
    // are applied; fall back to the entry-level `readable` flag if the server
    // didn't include the effective block.
    if (e.effective && typeof e.effective.read === "number") return e.effective.read === 1;
    return e.readable === 1;
  }
  const folderCanWrite = $derived(
    (() => {
      const cwd = data.breadcrumb[data.breadcrumb.length - 1];
      if (!cwd) return true;
      return Boolean(cwd.effective?.create);
    })(),
  );

  const quota = $derived(data.quota as { free?: number; limit?: number; used?: number; quota?: number; allocated?: number });
  const quotaUsed = $derived(quota?.used ?? quota?.allocated ?? 0);
  const quotaLimit = $derived(quota?.limit ?? quota?.quota ?? 0);
  const quotaPct = $derived(quotaLimit > 0 ? Math.min(100, Math.round((quotaUsed / quotaLimit) * 100)) : 0);

  let mkdirOpen = $state(false);
  let mkdirName = $state("");
  let renameTarget = $state<{ id: string; name: string; type: string } | null>(null);
  let renameValue = $state("");

  function isPdf(name: string): boolean { return /\.pdf$/i.test(name); }
  function isImage(name: string): boolean { return /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(name); }
  function isText(name: string): boolean { return /\.(txt|md|log|json|csv|xml|html?|css|js|ts|svelte|yaml|yml|ini|conf)$/i.test(name); }
  function isOffice(name: string): boolean { return /\.(docx?|xlsx?|pptx?|odt|ods|odp|rtf)$/i.test(name); }
  function openOffice(id: string, mode: "edit" | "read" = "edit") {
    const params = new URLSearchParams({ id, mode: mode === "read" ? "view" : "edit" });
    if (data.group) params.set("group", data.group);
    goto(`/files/edit?${params.toString()}`);
  }
  function viewUrl(id: string): string {
    const params = new URLSearchParams({ id });
    if (data.group) params.set("group", data.group);
    return `/api/files/view?${params.toString()}`;
  }
  function downloadUrl(id: string): string {
    const params = new URLSearchParams({ id });
    if (data.group) params.set("group", data.group);
    return `/api/files/download?${params.toString()}`;
  }

  // Drag & drop
  let dragActive = $state(false);
  let uploadFormEl: HTMLFormElement;
  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragActive = false;
    if (!folderCanWrite) return;
    const dropped = e.dataTransfer?.files;
    if (!dropped?.length || !uploadFormEl) return;
    const fileInput = uploadFormEl.querySelector('input[name="file"]') as HTMLInputElement;
    const dt = new DataTransfer();
    for (const f of Array.from(dropped)) dt.items.add(f);
    fileInput.files = dt.files;
    uploadFormEl.requestSubmit();
  }

  function activate(e: { id: string; type: string; parent_id: string; name: string; effective?: { read?: number }; readable?: number }) {
    if (e.type === "folder") { navTo(e.id); return; }
    if (!rowCanRead(e)) return;  // file is locked → click does nothing
    if (isOffice(e.name)) openOffice(e.id, "edit");
    else navToFile(e.id, e.parent_id);
  }
</script>

<div
  class="grid h-full"
  style="grid-template-rows: auto 1fr"
  ondragenter={(e) => { e.preventDefault(); if (folderCanWrite && !data.file) dragActive = true; }}
  ondragover={(e) => { e.preventDefault(); }}
  ondragleave={(e) => { if (e.currentTarget === e.target) dragActive = false; }}
  ondrop={onDrop}
  role="region"
  aria-label="Dateibrowser"
>
  <header class="flex items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-950/80 px-6 py-3">
    <div class="flex min-w-0 items-center gap-1 overflow-x-auto">
      <button
        class="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
        onclick={() => navTo("/")}
      >
        <Icon name="folder" size={14} />
        <span>Root</span>
      </button>
      {#each data.breadcrumb as b, i}
        {#if b.id !== "/"}
          <Icon name="chevron-right" size={14} class="text-zinc-600" />
          <button
            class="truncate rounded-md px-2 py-1 text-sm hover:bg-zinc-900 {!data.file && i === data.breadcrumb.length - 1 ? 'font-medium text-zinc-100' : 'text-zinc-400 hover:text-zinc-100'}"
            onclick={() => navTo(b.id)}
            title={b.name}
          >{b.name}</button>
        {/if}
      {/each}
      {#if data.file}
        <Icon name="chevron-right" size={14} class="text-zinc-600" />
        <span class="flex items-center gap-1 truncate rounded-md px-2 py-1 text-sm font-medium text-zinc-100" title={data.file.name}>
          <Icon name="file" size={14} />
          {data.file.name}
        </span>
      {/if}
      {#if busy}
        <span class="ml-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-600 border-t-indigo-400"></span>
      {/if}
    </div>

    <div class="flex shrink-0 items-center gap-3">
      {#if quotaLimit > 0 && !data.file}
        <div class="hidden items-center gap-2 text-xs text-zinc-500 md:flex" title="{fmtSize(quotaUsed)} / {fmtSize(quotaLimit)}">
          <div class="h-1.5 w-24 overflow-hidden rounded-full bg-zinc-800">
            <div class="h-full bg-indigo-400" style="width: {quotaPct}%"></div>
          </div>
          <span>{fmtSize(quotaUsed)} / {fmtSize(quotaLimit)}</span>
        </div>
      {/if}
      {#if data.file}
        {#if isOffice(data.file.name)}
          <button
            onclick={() => openOffice(data.file!.id, "edit")}
            class="flex items-center gap-1.5 rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-400"
          >
            <Icon name="edit" size={16} /> Bearbeiten
          </button>
        {/if}
        <a
          href={downloadUrl(data.file.id)}
          class="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm hover:bg-zinc-800"
        >
          <Icon name="download" size={16} /> Download
        </a>
      {:else if folderCanWrite}
        <button
          class="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm hover:bg-zinc-800"
          onclick={() => { mkdirOpen = true; mkdirName = ""; }}
        >
          <Icon name="folder-plus" size={16} /> Ordner
        </button>
        <form
          method="POST"
          action="?/upload"
          enctype="multipart/form-data"
          use:enhance={() => { busy = true; return async ({ update }) => { await update(); busy = false; }; }}
          bind:this={uploadFormEl}
          class="contents"
        >
          <input type="hidden" name="parent_id" value={data.folderId} />
          <input type="hidden" name="group" value={groupValue} />
          <label class="flex cursor-pointer items-center gap-1.5 rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-400">
            <Icon name="upload" size={16} /> Hochladen
            <input
              type="file"
              name="file"
              multiple
              class="hidden"
              onchange={(e) => {
                const input = e.currentTarget as HTMLInputElement;
                if (input.files?.length) input.form?.requestSubmit();
              }}
            />
          </label>
        </form>
      {/if}
    </div>
  </header>

  <section class="relative overflow-hidden">
    {#if dragActive && !data.file}
      <div class="pointer-events-none absolute inset-4 z-20 grid place-items-center rounded-2xl border-2 border-dashed border-indigo-400 bg-indigo-500/10">
        <p class="text-sm font-medium text-indigo-200">Datei hier ablegen zum Hochladen</p>
      </div>
    {/if}

    {#if data.file}
      <!-- Inline preview using the same area where the file list lives. -->
      <div class="grid h-full" style="grid-template-rows: 1fr">
        {#if isPdf(data.file.name)}
          <iframe class="h-full w-full bg-zinc-900" src={viewUrl(data.file.id)} title={data.file.name}></iframe>
        {:else if isImage(data.file.name)}
          <div class="grid h-full place-items-center overflow-auto bg-zinc-900 p-4">
            <img src={viewUrl(data.file.id)} alt={data.file.name} class="max-h-full max-w-full" />
          </div>
        {:else if isText(data.file.name)}
          <iframe class="h-full w-full bg-zinc-900" src={viewUrl(data.file.id)} title={data.file.name}></iframe>
        {:else}
          <div class="grid h-full place-items-center text-center text-sm text-zinc-500">
            <div class="max-w-sm">
              <div class="mx-auto mb-3 inline-grid h-12 w-12 place-items-center rounded-2xl bg-zinc-900 text-zinc-600">
                <Icon name="file" size={28} />
              </div>
              <p class="font-medium text-zinc-200">{data.file.name}</p>
              <p class="mt-1 text-zinc-500">{fmtSize(data.file.size)}</p>
              {#if isOffice(data.file.name)}
                <p class="mt-3 text-xs text-zinc-600">Bearbeiten oder herunterladen.</p>
                <div class="mt-4 flex justify-center gap-2">
                  <button onclick={() => openOffice(data.file!.id, "edit")} class="inline-flex items-center gap-1.5 rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-400">
                    <Icon name="edit" size={14} /> Bearbeiten
                  </button>
                  <a href={downloadUrl(data.file.id)} class="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm hover:bg-zinc-800">
                    <Icon name="download" size={14} /> Herunterladen
                  </a>
                </div>
              {:else}
                <p class="mt-3 text-xs text-zinc-600">Vorschau für diesen Dateityp nicht verfügbar.</p>
                <a href={downloadUrl(data.file.id)} class="mt-4 inline-flex items-center gap-1.5 rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-400">
                  <Icon name="download" size={14} /> Herunterladen
                </a>
              {/if}
            </div>
          </div>
        {/if}
      </div>
    {:else if data.permissionError}
      <div class="m-6 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
        Keine Berechtigung für die Dateien dieser Gruppe.
      </div>
    {:else if data.children.length === 0}
      <div class="grid place-items-center py-24 text-center text-sm text-zinc-500">
        <div>
          <div class="mb-3 inline-grid h-12 w-12 place-items-center rounded-2xl bg-zinc-900 text-zinc-600">
            <Icon name="folder" size={28} />
          </div>
          <p>Dieser Ordner ist leer.</p>
          {#if folderCanWrite}
            <p class="mt-2 text-xs text-zinc-600">Drag &amp; Drop oder „Hochladen".</p>
          {/if}
        </div>
      </div>
    {:else}
      <div class="h-full overflow-auto">
        <table class="w-full text-sm">
          <thead class="sticky top-0 z-10 bg-zinc-950 text-xs uppercase tracking-wide text-zinc-500">
            <tr class="border-b border-zinc-800">
              <th class="px-6 py-2 text-left font-medium">
                <button class="inline-flex items-center gap-1 hover:text-zinc-200" onclick={() => toggleSort("name")}>
                  Name {#if sortBy === "name"}<Icon name="chevron-down" size={12} class={sortDir === "asc" ? "rotate-180" : ""} />{/if}
                </button>
              </th>
              <th class="px-6 py-2 text-left font-medium">
                <button class="inline-flex items-center gap-1 hover:text-zinc-200" onclick={() => toggleSort("modified")}>
                  Geändert {#if sortBy === "modified"}<Icon name="chevron-down" size={12} class={sortDir === "asc" ? "rotate-180" : ""} />{/if}
                </button>
              </th>
              <th class="px-6 py-2 text-right font-medium">
                <button class="inline-flex items-center gap-1 hover:text-zinc-200" onclick={() => toggleSort("size")}>
                  Größe {#if sortBy === "size"}<Icon name="chevron-down" size={12} class={sortDir === "asc" ? "rotate-180" : ""} />{/if}
                </button>
              </th>
              <th class="px-6 py-2 text-right font-medium">Eigentümer</th>
              <th class="w-12"></th>
            </tr>
          </thead>
          <tbody>
            {#each sortedChildren as e}
              {@const canModify = rowCanModify(e)}
              {@const canRead = rowCanRead(e)}
              {@const isLocked = e.type === "file" && !canRead}
              {@const showMenu = e.type === "folder" ? canModify : (canRead || canModify)}
              <tr
                class="border-b border-zinc-900 transition
                  {isLocked ? 'opacity-60' : 'cursor-pointer hover:bg-zinc-900/50'}"
                onclick={() => activate(e)}
                onkeydown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); activate(e); } }}
                oncontextmenu={(ev) => {
                  // Always suppress the native menu on rows so the UI's
                  // behaviour is consistent — open ours only when there's
                  // something to show.
                  ev.preventDefault();
                  if (showMenu) openMenuFor(e, ev, true);
                }}
                tabindex="0"
                role="button"
                aria-label={e.name}
                title={isLocked ? "Kein Zugriff" : e.name}
              >
                <td class="px-6 py-2.5">
                  <span class="flex items-center gap-2">
                    <Icon name={e.type === "folder" ? "folder" : "file"} size={18} class={e.type === "folder" ? "text-amber-400" : "text-zinc-400"} />
                    <span class={e.type === "folder" ? "font-medium" : ""}>{e.name}</span>
                    {#if e.versions && e.versions.length > 1}
                      <span class="rounded-full border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400" title="{e.versions.length} Versionen">
                        v{e.versions.length}
                      </span>
                    {/if}
                  </span>
                </td>
                <td class="px-6 py-2.5 text-zinc-400">{fmtDate(e.modified?.date)}</td>
                <td class="px-6 py-2.5 text-right text-zinc-400">
                  {e.type === "folder" ? fmtSize(e.aggregation?.size) : fmtSize(e.size)}
                </td>
                <td class="px-6 py-2.5 text-right text-zinc-400">
                  <span class="truncate" title={e.created?.user?.login ?? ""} onclick={(ev) => ev.stopPropagation()} role="presentation"><PersonChip name={e.created?.user?.name_hr} login={e.created?.user?.login} /></span>
                </td>
                <td class="px-2 py-2.5 text-right" onclick={(ev) => ev.stopPropagation()} onkeydown={(ev) => ev.stopPropagation()}>
                  {#if showMenu}
                    <button
                      type="button"
                      class="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                      aria-haspopup="menu"
                      onclick={(ev) => openMenuFor(e, ev, false)}
                    ><Icon name="dots-vertical" size={16} /></button>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
</div>

{#if menu}
  {@const e = menu.entry}
  {@const canModify = rowCanModify(e)}
  {@const canRead = rowCanRead(e)}
  <div
    id="files-context-menu"
    role="menu"
    style="position: fixed; left: {Math.min(menu.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 192)}px; top: {Math.min(menu.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 240)}px;"
    class="z-50 w-48 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 p-1 shadow-2xl"
  >
    {#if e.type === "file" && canRead}
      {#if isOffice(e.name)}
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-sm text-indigo-300 hover:bg-zinc-900"
          onclick={() => { openOffice(e.id, "edit"); closeMenu(); }}
        ><Icon name="edit" size={14} /> Bearbeiten</button>
      {:else}
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-sm hover:bg-zinc-900"
          onclick={() => { navToFile(e.id, e.parent_id); closeMenu(); }}
        ><Icon name="file" size={14} /> Öffnen</button>
      {/if}
      <a
        href={downloadUrl(e.id)}
        class="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-sm hover:bg-zinc-900"
        onclick={closeMenu}
      ><Icon name="download" size={14} /> Herunterladen</a>
    {/if}
    {#if e.type === "file"}
      {#if e.versions && e.versions.length > 1}
        <button
          type="button"
          class="flex w-full items-center justify-between gap-2 rounded px-3 py-1.5 text-left text-sm hover:bg-zinc-900"
          onclick={() => { versionsKey = { parent_id: e.parent_id, name: e.name }; closeMenu(); }}
        >
          <span class="flex items-center gap-2"><Icon name="book-2" size={14} /> Versionen</span>
          <span class="text-[10px] text-zinc-500">{e.versions.length}</span>
        </button>
      {/if}
    {/if}
    {#if canModify}
      <button
        type="button"
        class="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-sm hover:bg-zinc-900"
        onclick={() => {
          renameTarget = { id: e.id, name: e.name, type: e.type };
          renameValue = e.name;
          closeMenu();
        }}
      ><Icon name="pencil" size={14} /> Umbenennen</button>
      <form
        method="POST"
        action="?/remove"
        use:enhance={() => async ({ update }) => { await update(); closeMenu(); }}
        class="block"
      >
        <input type="hidden" name="id" value={e.id} />
        <input type="hidden" name="type" value={e.type} />
        <input type="hidden" name="group" value={groupValue} />
        <button
          type="submit"
          class="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-sm text-red-400 hover:bg-zinc-900"
        ><Icon name="trash" size={14} /> Löschen</button>
      </form>
    {/if}
  </div>
{/if}

{#if versionsFor}
  {@const cur = versionsFor}
  <aside
    class="fixed right-0 top-0 z-40 flex h-full w-96 flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl"
  >
    <header class="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
      <div class="min-w-0">
        <p class="text-xs font-semibold uppercase tracking-wide text-zinc-500">Versionen</p>
        <p class="truncate text-sm font-medium" title={cur.name}>{cur.name}</p>
      </div>
      <button
        onclick={() => (versionsKey = null)}
        class="rounded p-1 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
        aria-label="Schließen"
      ><Icon name="x" size={16} /></button>
    </header>

    <ul class="flex-1 overflow-auto divide-y divide-zinc-900">
      {#each cur.versions as v, i}
        {@const isCurrent = i === 0}
        {@const canModifyV = Boolean(v.effective?.modify || v.effective?.delete)}
        <li class="px-4 py-3 {isCurrent ? 'bg-zinc-900/40' : ''}">
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0">
              <p class="text-sm font-medium">
                {fmtDate(v.created?.date)}
                {#if isCurrent}<span class="ml-2 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">aktuell</span>{/if}
              </p>
              <p class="truncate text-xs text-zinc-500" title={v.created?.user?.login ?? ""}>
                {v.created?.user?.name_hr ?? "—"} · {fmtSize(v.size)}
              </p>
            </div>
          </div>
          <div class="mt-2 flex flex-wrap gap-1.5">
            {#if isOffice(cur.name)}
              <button
                onclick={() => { versionsKey = null; openOffice(v.id, "edit"); }}
                class="flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs hover:bg-zinc-800"
              ><Icon name="edit" size={12} /> Bearbeiten</button>
            {:else}
              <button
                onclick={() => { versionsKey = null; navToFile(v.id, cur.parent_id); }}
                class="flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs hover:bg-zinc-800"
              ><Icon name="file" size={12} /> Öffnen</button>
            {/if}
            <a
              href={downloadUrl(v.id)}
              class="flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs hover:bg-zinc-800"
            ><Icon name="download" size={12} /> Download</a>
            {#if canModifyV}
              <button
                onclick={() => { renameTarget = { id: v.id, name: cur.name, type: "file" }; renameValue = cur.name; versionsKey = null; }}
                class="flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs hover:bg-zinc-800"
              ><Icon name="pencil" size={12} /> Umbenennen</button>
              <form
                method="POST"
                action="?/remove"
                use:enhance={() => async ({ update }) => { await update(); }}
                class="contents"
              >
                <input type="hidden" name="id" value={v.id} />
                <input type="hidden" name="type" value="file" />
                <input type="hidden" name="group" value={groupValue} />
                <button
                  type="submit"
                  class="flex items-center gap-1 rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-red-300 hover:bg-red-500/20"
                ><Icon name="trash" size={12} /> Löschen</button>
              </form>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  </aside>
{/if}

<Modal open={mkdirOpen} onclose={() => (mkdirOpen = false)} title="Neuer Ordner">
  <form
    method="POST"
    action="?/mkdir"
    use:enhance={() => async ({ update }) => { await update(); mkdirOpen = false; mkdirName = ""; }}
  >
    <input type="hidden" name="parent_id" value={data.folderId} />
    <input type="hidden" name="group" value={groupValue} />
    <input
      name="name"
      bind:value={mkdirName}
      placeholder="Ordnername"
      required
      class="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-indigo-500"
    />
    <div class="mt-4 flex justify-end gap-2">
      <button type="button" onclick={() => (mkdirOpen = false)} class="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-100">Abbrechen</button>
      <button type="submit" class="rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium hover:bg-indigo-400">Anlegen</button>
    </div>
  </form>
</Modal>

<Modal open={renameTarget !== null} onclose={() => (renameTarget = null)} title="Umbenennen">
  {#if renameTarget}
    <form
      method="POST"
      action="?/rename"
      use:enhance={() => async ({ update }) => { await update(); renameTarget = null; }}
    >
      <input type="hidden" name="id" value={renameTarget.id} />
      <input type="hidden" name="type" value={renameTarget.type} />
      <input type="hidden" name="group" value={groupValue} />
      <input
        name="name"
        bind:value={renameValue}
        required
        class="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-indigo-500"
      />
      <div class="mt-4 flex justify-end gap-2">
        <button type="button" onclick={() => (renameTarget = null)} class="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-100">Abbrechen</button>
        <button type="submit" class="rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium hover:bg-indigo-400">Speichern</button>
      </div>
    </form>
  {/if}
</Modal>
