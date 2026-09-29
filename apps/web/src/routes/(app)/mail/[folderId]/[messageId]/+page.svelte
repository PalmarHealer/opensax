<script lang="ts">
  import { enhance } from "$app/forms";
  import { invalidate } from "$app/navigation";
  import Dropdown from "$lib/Dropdown.svelte";
  import Icon from "$lib/Icon.svelte";
  import { linkifyPlain, sanitizeHtml } from "$lib/linkify";
  import { composeStore } from "$lib/composeStore.svelte";
  import PersonChip from "$lib/PersonChip.svelte";

  let { data } = $props();
  const m = $derived(data.message);
  const flagged = $derived(Boolean(m.is_flagged));
  const folders = $derived((data as unknown as { folders?: Array<{ id: string; name: string; is_drafts?: boolean }> }).folders ?? []);
  const moveTargets = $derived(folders.filter((f) => f.id !== data.folderId));
  const isDraft = $derived(folders.find((f) => f.id === data.folderId)?.is_drafts ?? false);
  let moveFormEl = $state<HTMLFormElement | undefined>();
  let flagFormEl = $state<HTMLFormElement | undefined>();
  let unreadFormEl = $state<HTMLFormElement | undefined>();

  const btn = "flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm hover:bg-zinc-800 sm:px-3";
  const lbl = "max-sm:hidden";
  const item = "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-zinc-800 sm:py-1.5";
  let moveTarget = $state("");

  // Reading a message flips its unread state on the server — re-fetch the list
  // so the sidebar reflects it. Keyed on id so it fires once per message.
  $effect(() => { void m.id; invalidate("mail:list"); });

  async function openCompose(mode: "reply" | "reply-all" | "forward" | "draft") {
    const u = new URL("/api/mail/compose-prefill", window.location.origin);
    u.searchParams.set("mode", mode);
    u.searchParams.set("folder", data.folderId);
    u.searchParams.set("message", String(m.id));
    const res = await fetch(u);
    if (res.ok) {
      const prefill = await res.json();
      composeStore.openWith(prefill);
    } else {
      composeStore.openNew();
    }
  }
  function fmt(ts: number | undefined) {
    if (!ts) return "";
    return new Date(ts * 1000).toLocaleString("de-DE", { dateStyle: "long", timeStyle: "short" });
  }
  function partyDisplay(p: { addr: string; name?: string } | undefined): string {
    if (!p) return "—";
    return p.name && p.name !== p.addr ? `${p.name} <${p.addr}>` : p.addr;
  }
  function attHref(fileId: string): string {
    const params = new URLSearchParams({
      folder_id: data.folderId,
      message_id: String(m.id),
      file_id: fileId,
    });
    return `/api/mail/attachment?${params.toString()}`;
  }
  function fmtSize(b: number): string {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  }
</script>

<article class="mx-auto flex min-h-full min-w-0 max-w-3xl flex-col px-4 pb-6 sm:px-8">
  <!-- Toolbar bleibt beim Scrollen oben; auf dem Handy nur Icons, der Rest im Mehr-Menü. -->
  <header class="sticky top-0 z-10 -mx-4 mb-4 flex items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-950/80 px-4 py-2 backdrop-blur sm:-mx-8 sm:px-8 sm:py-3">
    <a
      href="/mail?folder={encodeURIComponent(data.folderId)}"
      class="-ml-1.5 inline-flex shrink-0 items-center gap-1 rounded-md p-1.5 text-sm text-indigo-400 hover:text-indigo-300"
      aria-label="Zurück"
    >
      <Icon name="chevron-left" size={18} /> <span class="max-sm:hidden">zurück</span>
    </a>
    <div class="flex min-w-0 items-center gap-1">
      {#if isDraft}
        <button onclick={() => openCompose("draft")} class="{btn} border-indigo-500/40 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20" title="Entwurf bearbeiten">
          <Icon name="edit" size={14} /> Bearbeiten
        </button>
      {:else}
        <button onclick={() => openCompose("reply")} class={btn} title="Antworten" aria-label="Antworten">
          <Icon name="chevron-left" size={14} /> <span class={lbl}>Antworten</span>
        </button>
        <button onclick={() => openCompose("forward")} class={btn} title="Weiterleiten" aria-label="Weiterleiten">
          <Icon name="chevron-right" size={14} /> <span class={lbl}>Weiterleiten</span>
        </button>
        <form method="POST" action="?/flag" use:enhance class="max-sm:hidden">
          <input type="hidden" name="is_flagged" value={(!flagged).toString()} />
          <button class={btn} class:text-amber-300={flagged} title={flagged ? "Markierung entfernen" : "Als wichtig markieren"}>
            <Icon name="star" size={14} /> {flagged ? "Markiert" : "Wichtig"}
          </button>
        </form>
      {/if}
      <form method="POST" action="?/delete" use:enhance>
        <button class="{btn} border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20" title="Löschen" aria-label="Löschen">
          <Icon name="trash" size={14} /> <span class={lbl}>Löschen</span>
        </button>
      </form>
      <!-- Seltenere Aktionen gesammelt, damit die Leiste auch auf 320px passt. -->
      <form method="POST" action="?/flag" use:enhance bind:this={flagFormEl} class="hidden">
        <input type="hidden" name="is_flagged" value={(!flagged).toString()} />
      </form>
      <form method="POST" action="?/flag" use:enhance bind:this={unreadFormEl} class="hidden">
        <input type="hidden" name="is_unread" value="true" />
      </form>
      <form method="POST" action="?/move" use:enhance bind:this={moveFormEl} class="hidden">
        <input type="hidden" name="target_folder_id" bind:value={moveTarget} />
      </form>
      <Dropdown align="right" buttonClass={btn}>
        {#snippet label()}
          <span class="sr-only">Weitere Aktionen</span><Icon name="dots-vertical" size={14} />
        {/snippet}
        {#snippet children(close)}
          <ul class="max-h-[60vh] overflow-y-auto">
            {#if !isDraft}
              <li>
                <button type="button" role="menuitem" class={item} onclick={() => { close(); openCompose("reply-all"); }}>
                  <Icon name="chevron-left" size={14} /> Allen antworten
                </button>
              </li>
              <li class="sm:hidden">
                <button type="button" role="menuitem" class="{item} {flagged ? 'text-amber-300' : ''}" onclick={() => { close(); flagFormEl?.requestSubmit(); }}>
                  <Icon name="star" size={14} /> {flagged ? "Markierung entfernen" : "Als wichtig markieren"}
                </button>
              </li>
              <li>
                <button type="button" role="menuitem" class={item} onclick={() => { close(); unreadFormEl?.requestSubmit(); }}>
                  <Icon name="mail-opened" size={14} /> Als ungelesen markieren
                </button>
              </li>
            {/if}
            {#if moveTargets.length}
              <li class="mt-1 border-t border-zinc-800 px-2 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Verschieben nach</li>
              {#each moveTargets as f}
                <li>
                  <button
                    type="button"
                    role="menuitem"
                    class={item}
                    onclick={() => { moveTarget = f.id; close(); moveFormEl?.requestSubmit(); }}
                  >
                    <Icon name="folder" size={14} />
                    <span class="truncate">{f.name}</span>
                  </button>
                </li>
              {/each}
            {/if}
          </ul>
        {/snippet}
      </Dropdown>
    </div>
  </header>

  <h1 class="text-xl font-semibold tracking-tight [overflow-wrap:anywhere] sm:text-2xl">{m.subject ?? "(kein Betreff)"}</h1>
  <div class="mt-2 text-sm text-zinc-400 [overflow-wrap:anywhere]">
    Von <span class="text-zinc-200"><PersonChip name={m.from?.[0]?.name} login={m.from?.[0]?.addr} /></span> · {fmt(m.date)}
  </div>
  {#if m.to?.length}
    <div class="text-xs text-zinc-500 [overflow-wrap:anywhere]">an {m.to.map((r) => r.addr).join(", ")}</div>
  {/if}
  {#if m.cc?.length}
    <div class="text-xs text-zinc-500 [overflow-wrap:anywhere]">cc {m.cc.map((r) => r.addr).join(", ")}</div>
  {/if}

  <hr class="my-4 border-zinc-800 sm:my-6" />

  {#if m.body_html}
    <!-- HTML-Mails bringen feste Breiten mit (Newsletter-Tabellen, große Bilder):
         Bilder schrumpfen, alles andere scrollt innerhalb des Bodys statt die Seite zu verbreitern. -->
    <div class="prose prose-invert max-w-none overflow-x-auto text-sm leading-relaxed [overflow-wrap:anywhere] [&_img]:h-auto [&_img]:max-w-full [&_pre]:whitespace-pre-wrap">
      {@html sanitizeHtml(m.body_html)}
    </div>
  {:else}
    <div class="whitespace-normal text-sm [overflow-wrap:anywhere] leading-relaxed text-zinc-200">
      {@html linkifyPlain(m.body_plain ?? "")}
    </div>
  {/if}

  {#if m.files?.length}
    <section class="mt-8 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 sm:p-4">
      <h2 class="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-300">
        <Icon name="paperclip" size={16} />
        {m.files.length} {m.files.length === 1 ? "Anhang" : "Anhänge"}
      </h2>
      <ul class="space-y-1 text-sm">
        {#each m.files as a}
          <li>
            <a
              href={attHref(a.id)}
              target="_blank"
              rel="noopener"
              class="flex items-center justify-between gap-3 rounded-md border border-zinc-800 bg-zinc-950/50 px-3 py-2 transition hover:border-indigo-500/40 hover:bg-zinc-900"
            >
              <span class="flex min-w-0 items-center gap-2">
                <Icon name="file" size={16} />
                <span class="truncate">{a.name}</span>
              </span>
              <span class="flex shrink-0 items-center gap-2 text-xs text-zinc-500">
                <span>{fmtSize(a.size)}</span>
                <Icon name="download" size={16} />
              </span>
            </a>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</article>
