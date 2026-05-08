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
  const folders = $derived((data as unknown as { folders?: Array<{ id: string; name: string }> }).folders ?? []);
  const moveTargets = $derived(folders.filter((f) => f.id !== data.folderId));
  let moveFormEl = $state<HTMLFormElement | undefined>();
  let moveTarget = $state("");

  // Reading a message flips its unread state on the server — re-fetch the list
  // so the sidebar reflects it. Keyed on id so it fires once per message.
  $effect(() => { void m.id; invalidate("mail:list"); });

  async function openCompose(mode: "reply" | "reply-all" | "forward") {
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

<article class="mx-auto flex h-full max-w-3xl flex-col px-8 py-6">
  <header class="mb-4 flex items-center justify-between gap-3">
    <a href="/mail?folder={encodeURIComponent(data.folderId)}" class="inline-flex items-center gap-1 text-sm text-indigo-400 hover:text-indigo-300">
      <Icon name="chevron-left" size={16} /> zurück
    </a>
    <div class="flex items-center gap-1">
      <button onclick={() => openCompose("reply")} class="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm hover:bg-zinc-800">
        <Icon name="chevron-left" size={14} /> Antworten
      </button>
      <button onclick={() => openCompose("reply-all")} class="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm hover:bg-zinc-800" title="Allen antworten">
        Allen
      </button>
      <button onclick={() => openCompose("forward")} class="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm hover:bg-zinc-800" title="Weiterleiten">
        <Icon name="chevron-right" size={14} /> Weiterleiten
      </button>
      <form method="POST" action="?/flag" use:enhance>
        <input type="hidden" name="is_flagged" value={(!flagged).toString()} />
        <button
          class="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm hover:bg-zinc-800"
          class:text-amber-300={flagged}
          title={flagged ? "Markierung entfernen" : "Als wichtig markieren"}
        >
          <Icon name="star" size={14} /> {flagged ? "Markiert" : "Wichtig"}
        </button>
      </form>
      <form method="POST" action="?/flag" use:enhance>
        <input type="hidden" name="is_unread" value="true" />
        <button class="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm hover:bg-zinc-800" title="Als ungelesen markieren">
          <Icon name="mail-opened" size={14} /> Ungelesen
        </button>
      </form>
      {#if moveTargets.length}
        <form method="POST" action="?/move" use:enhance bind:this={moveFormEl}>
          <input type="hidden" name="target_folder_id" bind:value={moveTarget} />
        </form>
        <Dropdown align="right" buttonClass="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm hover:bg-zinc-800">
          {#snippet label()}
            <Icon name="folder" size={14} /> Verschieben <Icon name="chevron-down" size={12} />
          {/snippet}
          {#snippet children(close)}
            <ul class="max-h-72 overflow-y-auto">
              {#each moveTargets as f}
                <li>
                  <button
                    type="button"
                    role="menuitem"
                    class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-zinc-800"
                    onclick={() => { moveTarget = f.id; close(); moveFormEl?.requestSubmit(); }}
                  >
                    <Icon name="folder" size={14} />
                    <span class="truncate">{f.name}</span>
                  </button>
                </li>
              {/each}
            </ul>
          {/snippet}
        </Dropdown>
      {/if}
      <form method="POST" action="?/delete" use:enhance>
        <button class="flex items-center gap-1.5 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-sm text-red-300 hover:bg-red-500/20" title="Löschen">
          <Icon name="trash" size={14} /> Löschen
        </button>
      </form>
    </div>
  </header>

  <h1 class="text-2xl font-semibold tracking-tight break-words">{m.subject ?? "(kein Betreff)"}</h1>
  <div class="mt-2 text-sm text-zinc-400">
    Von <span class="text-zinc-200"><PersonChip name={m.from?.[0]?.name} login={m.from?.[0]?.addr} /></span> · {fmt(m.date)}
  </div>
  {#if m.to?.length}
    <div class="text-xs text-zinc-500">an {m.to.map((r) => r.addr).join(", ")}</div>
  {/if}
  {#if m.cc?.length}
    <div class="text-xs text-zinc-500">cc {m.cc.map((r) => r.addr).join(", ")}</div>
  {/if}

  <hr class="my-6 border-zinc-800" />

  {#if m.body_html}
    <div class="prose prose-invert max-w-none break-words text-sm leading-relaxed">
      {@html sanitizeHtml(m.body_html)}
    </div>
  {:else}
    <div class="whitespace-normal break-words text-sm leading-relaxed text-zinc-200">
      {@html linkifyPlain(m.body_plain ?? "")}
    </div>
  {/if}

  {#if m.files?.length}
    <section class="mt-8 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
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
