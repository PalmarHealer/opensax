<script lang="ts">
  import { enhance } from "$app/forms";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import Icon from "$lib/Icon.svelte";
  import Modal from "$lib/Modal.svelte";
  import ConfirmModal from "$lib/ConfirmModal.svelte";
  import PersonChip from "$lib/PersonChip.svelte";
  import { sanitizeHtml, linkifyPlain } from "$lib/linkify";
  import { FORUM_ICON_CHOICES, forumIcon } from "$lib/forumIcons";
  import type { ForumEntry, ForumStamp } from "@lernsax/core";

  let { data, form } = $props();
  const groupValue = $derived(data.group ?? "");

  function stampDate(ts: ForumStamp | undefined): number | undefined {
    if (ts === undefined) return undefined;
    return typeof ts === "object" ? ts.date : ts;
  }
  function stampUser(ts: ForumStamp | undefined): { login?: string; name_hr?: string } | undefined {
    return typeof ts === "object" ? ts?.user : undefined;
  }
  function fmt(ts: ForumStamp | undefined): string {
    const n = Number(stampDate(ts));
    if (!Number.isFinite(n) || n <= 0) return "";
    return new Date(n * 1000).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
  }
  function authorOf(e: ForumEntry): { name?: string; login?: string } {
    const u = stampUser(e.created);
    return {
      name: u?.name_hr ?? e.author?.name_hr,
      login: u?.login ?? e.author?.login,
    };
  }
  function wasEdited(e: ForumEntry): boolean {
    const c = stampDate(e.created);
    const m = stampDate(e.modified);
    return !!c && !!m && m > c;
  }
  function looksHtml(s: string): boolean { return /<[a-z][\s\S]*>/i.test(s); }
  function openThread(id: string | null) {
    const u = new URL(page.url);
    if (id) u.searchParams.set("thread", id); else u.searchParams.delete("thread");
    goto(u.pathname + u.search, { invalidateAll: true });
  }

  // Wie in LernSax: eigene Beiträge darf man überarbeiten und löschen, fremde
  // nur mit Forum-Adminrecht. Durchsetzen tut es ohnehin der Server.
  const groups = $derived((page.data.groups as Array<{ login: string; effective_rights?: string[] }>) ?? []);
  const isAdmin = $derived(groups.find((g) => g.login === data.group)?.effective_rights?.includes("forum_admin") ?? false);
  const me = $derived((page.data.user as { login?: string } | null)?.login?.toLowerCase());
  function canManage(e: ForumEntry): boolean {
    return isAdmin || (!!me && authorOf(e).login?.toLowerCase() === me);
  }

  /**
   * Ein Editor für alles: neues Thema, Antwort, Überarbeiten.
   * `null` = geschlossen.
   */
  type Editor =
    | { mode: "thread" }
    | { mode: "reply" }
    | { mode: "edit"; id: string; title: string; text: string };
  let editor = $state<Editor | null>(null);
  let icon = $state(0);
  let saving = $state(false);
  let editorError = $state<string | null>(null);

  function openEditor(e: Editor, initialIcon = 0) {
    editor = e;
    icon = initialIcon;
    editorError = null;
  }
  function editEntry(e: ForumEntry) {
    openEditor({ mode: "edit", id: e.id, title: e.title ?? "", text: e.text ?? "" }, e.icon ?? 0);
  }
  /** Beitrag, dessen Löschen gerade bestätigt werden soll. */
  let deleting = $state<{ id: string; title: string; isThread: boolean } | null>(null);
  const replyCount = $derived(data.replies.filter((r) => r.id !== data.thread).length);

  const editorTitle = $derived(
    editor?.mode === "edit" ? "Beitrag überarbeiten" : editor?.mode === "reply" ? "Antworten" : "Neues Thema",
  );
</script>

{#snippet iconBadge(id: number | undefined, size = 16)}
  {@const i = forumIcon(id)}
  <span class="shrink-0 {i.color}" title={i.label}><Icon name={i.icon} {size} /></span>
{/snippet}

{#snippet actions(e: ForumEntry, isThread: boolean)}
  {#if canManage(e)}
    <div class="flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        onclick={() => editEntry(e)}
        class="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
        title="Überarbeiten"
        aria-label="Überarbeiten"
      ><Icon name="pencil" size={15} /></button>
      <button
        type="button"
        onclick={() => (deleting = { id: e.id, title: e.title ?? "", isThread })}
        class="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
        title="Löschen"
        aria-label="Löschen"
      ><Icon name="trash" size={15} /></button>
    </div>
  {/if}
{/snippet}

{#snippet body(text: string | undefined)}
  {#if looksHtml(text ?? "")}
    <div class="prose prose-invert prose-sm mt-3 max-w-none leading-relaxed [overflow-wrap:anywhere]">{@html sanitizeHtml(text ?? "")}</div>
  {:else}
    <div class="mt-3 text-sm leading-relaxed text-zinc-200 [overflow-wrap:anywhere]">{@html linkifyPlain(text ?? "")}</div>
  {/if}
{/snippet}

{#snippet meta(e: ForumEntry)}
  {@const a = authorOf(e)}
  <p class="mt-1 flex flex-wrap items-center gap-x-1 text-xs text-zinc-500">
    <span class="font-medium text-zinc-400"><PersonChip name={a.name} login={a.login} /></span>
    <span>· {fmt(e.created)}</span>
    {#if wasEdited(e)}<span class="text-zinc-600">(bearb. {fmt(e.modified)})</span>{/if}
  </p>
{/snippet}

<div class="grid h-full" style="grid-template-rows: auto 1fr">
  <header class="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-950/80 px-4 py-3 sm:px-6">
    <div class="flex items-center gap-3">
      {#if data.thread}
        <button class="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100" onclick={() => openThread(null)} aria-label="Zurück">
          <Icon name="chevron-left" size={18} />
        </button>
      {/if}
      <h1 class="text-lg font-semibold tracking-tight">Forum</h1>
    </div>
    {#if data.group && !data.thread}
      <button onclick={() => openEditor({ mode: "thread" })} class="flex items-center gap-1.5 rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-400">
        <Icon name="plus" size={16} /> Thema
      </button>
    {:else if data.group && data.thread}
      <button onclick={() => openEditor({ mode: "reply" })} class="flex items-center gap-1.5 rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-400">
        <Icon name="message-2" size={16} /> Antworten
      </button>
    {/if}
  </header>

  <section class="overflow-auto px-4 py-6 sm:px-6">
    {#if form?.error && !editor}
      <p class="mx-auto mb-3 max-w-3xl rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{form.error}</p>
    {/if}
    {#if !data.group}
      <p class="text-center text-sm text-zinc-500">Keine Gruppe gewählt.</p>
    {:else if data.thread}
      <div class="mx-auto max-w-3xl space-y-3">
        {#if data.root}
          <article class="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4 sm:p-5">
            <div class="flex items-start gap-2">
              <div class="mt-1">{@render iconBadge(data.root.icon, 18)}</div>
              <div class="min-w-0 flex-1">
                <h2 class="text-lg font-semibold [overflow-wrap:anywhere]">{data.root.title}</h2>
                {@render meta(data.root)}
              </div>
              {@render actions(data.root, true)}
            </div>
            {@render body(data.root.text)}
          </article>
        {:else}
          <p class="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5 text-sm text-zinc-500">Thread-Inhalt nicht verfügbar.</p>
        {/if}
        {#each data.replies.filter((r) => r.id !== data.thread) as r}
          <article class="ml-3 rounded-xl border border-zinc-800 bg-zinc-900/20 p-4 sm:ml-6">
            <div class="flex items-start gap-2">
              <div class="mt-0.5">{@render iconBadge(r.icon)}</div>
              <div class="min-w-0 flex-1">
                {#if r.title && r.title !== `Re: ${data.root?.title}`}
                  <h3 class="text-sm font-semibold [overflow-wrap:anywhere]">{r.title}</h3>
                {/if}
                {@render meta(r)}
              </div>
              {@render actions(r, false)}
            </div>
            {@render body(r.text)}
          </article>
        {:else}
          <p class="py-6 text-center text-sm text-zinc-500">Noch keine Antworten.</p>
        {/each}
      </div>
    {:else}
      <div class="mx-auto max-w-3xl space-y-2">
        {#each data.threads as t}
          {@const threadAuthor = authorOf(t)}
          {@const replies = t.children?.count ?? t.reply_count ?? 0}
          <button
            type="button"
            onclick={() => openThread(t.id)}
            class="flex w-full items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-900/30 p-4 text-left transition hover:bg-zinc-900/60"
          >
            <div class="mt-0.5">{@render iconBadge(t.icon)}</div>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-semibold">{t.title}</p>
              <p class="mt-1 truncate text-xs text-zinc-500">
                <span class="text-zinc-400">{threadAuthor.name || threadAuthor.login || "Unbekannt"}</span>
                <span> · {fmt(t.created)}</span>
                {#if replies}<span> · {replies} {replies === 1 ? "Antwort" : "Antworten"}</span>{/if}
              </p>
            </div>
            <span class="text-zinc-500"><Icon name="chevron-right" size={16} /></span>
          </button>
        {:else}
          <p class="py-12 text-center text-sm text-zinc-500">Keine Themen.</p>
        {/each}
      </div>
    {/if}
  </section>
</div>

<Modal open={editor !== null} onclose={() => { if (!saving) editor = null; }} title={editorTitle} width="max-w-lg">
  {#if editor}
    <form
      method="POST"
      action={editor.mode === "edit" ? "?/update" : "?/post"}
      use:enhance={() => {
        saving = true;
        editorError = null;
        return async ({ result, update }) => {
          saving = false;
          if (result.type === "failure") {
            editorError = (result.data?.error as string | undefined) ?? "Speichern fehlgeschlagen.";
            return;
          }
          await update();
          editor = null;
        };
      }}
      class="space-y-3"
    >
      {#if editorError}
        <p class="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-400">{editorError}</p>
      {/if}
      <input type="hidden" name="group" value={groupValue} />
      <input type="hidden" name="icon" value={icon} />
      {#if editor.mode === "edit"}
        <input type="hidden" name="id" value={editor.id} />
      {:else if editor.mode === "reply"}
        <input type="hidden" name="parent_id" value={data.thread ?? ""} />
      {/if}
      <input
        name="title"
        placeholder="Betreff"
        required
        value={editor.mode === "edit" ? editor.title : editor.mode === "reply" && data.root ? `Re: ${data.root.title}` : ""}
        class="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm font-semibold outline-none focus:border-indigo-500"
      />
      <textarea
        name="text"
        placeholder={editor.mode === "reply" ? "Antwort…" : "Text…"}
        required
        rows="8"
        value={editor.mode === "edit" ? editor.text : ""}
        class="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-indigo-500"
      ></textarea>
      <div>
        <p class="mb-1.5 text-xs font-medium text-zinc-400">Symbol</p>
        <div class="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
          {#each FORUM_ICON_CHOICES as c}
            <button
              type="button"
              onclick={() => (icon = c.id)}
              aria-pressed={icon === c.id}
              class="flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition
                {icon === c.id ? 'border-indigo-500 bg-indigo-500/10 text-zinc-100' : 'border-zinc-800 text-zinc-400 hover:bg-zinc-900'}"
            >
              <span class={c.color}><Icon name={c.icon} size={14} /></span>
              {c.label}
            </button>
          {/each}
        </div>
      </div>
      {#if editor.mode === "edit"}
        <p class="text-xs text-zinc-500">Wird über die LernSax-Weboberfläche gespeichert und kann ein paar Sekunden dauern.</p>
      {/if}
      <div class="flex justify-end gap-2 pt-1">
        <button type="button" disabled={saving} onclick={() => (editor = null)} class="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-100 disabled:opacity-50">Abbrechen</button>
        <button type="submit" disabled={saving} class="rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-60">
          {saving ? "Speichert…" : editor.mode === "edit" ? "Speichern" : editor.mode === "reply" ? "Senden" : "Posten"}
        </button>
      </div>
    </form>
  {/if}
</Modal>

<ConfirmModal
  open={deleting !== null}
  onclose={() => (deleting = null)}
  title={deleting?.isThread ? "Thema löschen" : "Antwort löschen"}
  action="?/remove"
  fields={{ group: groupValue, id: deleting?.id ?? "", ...(deleting?.isThread ? { is_thread: "1" } : {}) }}
>
  {#if deleting}
    <p>„<span class="font-medium text-zinc-100 [overflow-wrap:anywhere]">{deleting.title}</span>“ wirklich löschen?</p>
    {#if deleting.isThread && replyCount > 0}
      <p class="mt-2 text-zinc-400">
        Damit {replyCount === 1 ? "wird auch die Antwort" : `werden auch alle ${replyCount} Antworten`} gelöscht.
      </p>
    {/if}
    <p class="mt-2 text-xs text-zinc-500">Das lässt sich nicht rückgängig machen.</p>
  {/if}
</ConfirmModal>
