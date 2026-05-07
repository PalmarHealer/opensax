<script lang="ts">
  import { enhance } from "$app/forms";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import Icon from "$lib/Icon.svelte";
  import Modal from "$lib/Modal.svelte";
  import { sanitizeHtml, linkifyPlain } from "$lib/linkify";
  import { BOARD_COLORS, boardColor } from "$lib/boardColors";

  let { data } = $props();
  const groups = $derived((page.data.groups as Array<{ login: string; effective_rights?: string[]; member_rights?: string[] }>) ?? []);
  const groupValue = $derived(data.group ?? "");

  function fmt(ts: number | undefined): string {
    if (!ts) return "";
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return "";
    return new Date(n * 1000).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
  }
  function navParam(key: string, val: string | null) {
    const u = new URL(page.url);
    if (val) u.searchParams.set(key, val);
    else u.searchParams.delete(key);
    goto(u.pathname + u.search, { invalidateAll: true });
  }
  function looksHtml(s: string): boolean {
    return /<[a-z][\s\S]*>/i.test(s);
  }

  const canWrite = $derived.by(() => {
    if (!data.group) return false;
    const g = groups.find((g) => g.login === data.group);
    if (!g) return false;
    const rights = [...(g.effective_rights ?? []), ...(g.member_rights ?? [])];
    if (data.kind === "general") return rights.includes("board_admin") || rights.includes("board_write");
    if (data.kind === "teacher") return rights.includes("board_teacher_admin") || rights.includes("board_teacher_write");
    if (data.kind === "pupil") return rights.includes("board_pupil_admin") || rights.includes("board_pupil_write");
    return false;
  });

  let composing = $state(false);
  let composeColor = $state(0);
</script>

<div class="grid h-full" style="grid-template-rows: auto 1fr">
  <header class="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-950/80 px-6 py-3">
    <div class="flex items-center gap-3">
      <h1 class="text-lg font-semibold tracking-tight">Mitteilungen</h1>
      <div class="flex rounded-md border border-zinc-800 bg-zinc-900 p-0.5 text-xs">
        {#each [["general","Allgemein"],["teacher","Lehrer"],["pupil","Schüler"]] as [k, label]}
          <button
            class="rounded-sm px-2.5 py-1 transition {data.kind === k ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}"
            onclick={() => navParam("kind", k)}
          >{label}</button>
        {/each}
      </div>
    </div>
    {#if data.group && canWrite}
      <button
        onclick={() => { composing = true; composeColor = 0; }}
        class="flex items-center gap-1.5 rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-400"
      >
        <Icon name="plus" size={16} /> Beitrag
      </button>
    {/if}
  </header>

  <section class="overflow-auto px-6 py-6">
    {#if !data.group}
      <div class="grid place-items-center py-24 text-center text-sm text-zinc-500">
        <div>
          <div class="mb-3 inline-grid h-12 w-12 place-items-center rounded-2xl bg-zinc-900 text-zinc-600">
            <Icon name="speakerphone" size={28} />
          </div>
          <p>Du bist in keiner Gruppe.</p>
        </div>
      </div>
    {:else}
      <div class="mx-auto max-w-3xl space-y-3">
        {#each data.entries as e}
          {@const col = boardColor(e.color)}
          <article class="group relative overflow-hidden rounded-2xl border {col.border} {col.tint}">
            <div class="absolute inset-y-0 left-0 w-1 {col.accent}"></div>
            <div class="p-5 pl-6">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                  {#if looksHtml(e.title ?? "")}
                    <h2 class="prose prose-invert prose-sm max-w-none break-words text-base font-semibold">{@html sanitizeHtml(e.title)}</h2>
                  {:else}
                    <h2 class="break-words text-base font-semibold">{e.title}</h2>
                  {/if}
                  <p class="mt-1 flex items-center gap-2 text-xs text-zinc-500">
                    <span class="font-medium text-zinc-400">{e.created?.user?.name_hr ?? e.created?.user?.login ?? "—"}</span>
                    <span>·</span>
                    <span>{fmt(e.created?.date)}</span>
                    {#if e.modified && e.modified.date && e.modified.date !== e.created?.date}
                      <span class="text-zinc-600">(bearb. {fmt(e.modified.date)})</span>
                    {/if}
                  </p>
                </div>
                {#if canWrite}
                  <form method="POST" action="?/remove" use:enhance class="opacity-0 transition group-hover:opacity-100">
                    <input type="hidden" name="id" value={e.id} />
                    <input type="hidden" name="group" value={groupValue} />
                    <button class="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-red-400" aria-label="Löschen">
                      <Icon name="trash" size={14} />
                    </button>
                  </form>
                {/if}
              </div>
              {#if looksHtml(e.text ?? "")}
                <div class="prose prose-invert prose-sm mt-3 max-w-none break-words leading-relaxed">
                  {@html sanitizeHtml(e.text ?? "")}
                </div>
              {:else}
                <div class="mt-3 break-words text-sm leading-relaxed text-zinc-200">
                  {@html linkifyPlain(e.text ?? "")}
                </div>
              {/if}
            </div>
          </article>
        {:else}
          <p class="py-12 text-center text-sm text-zinc-500">Keine Beiträge.</p>
        {/each}
      </div>
    {/if}
  </section>
</div>

<Modal open={composing} onclose={() => (composing = false)} title="Neuer Beitrag">
  <form
    method="POST"
    action="?/post"
    use:enhance={() => async ({ update }) => { await update(); composing = false; }}
    class="space-y-3"
  >
    <input type="hidden" name="group" value={groupValue} />
    <input type="hidden" name="color" value={composeColor} />
    <input
      name="title"
      placeholder="Titel"
      required
      class="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm font-semibold outline-none focus:border-indigo-500"
    />
    <textarea
      name="text"
      placeholder="Text… (HTML erlaubt: &lt;b&gt;, &lt;i&gt;, &lt;u&gt;, Links)"
      required
      rows="6"
      class="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-indigo-500"
    ></textarea>
    <div>
      <p class="mb-1.5 text-xs font-medium text-zinc-400">Farbe</p>
      <div class="flex gap-1.5">
        {#each BOARD_COLORS as c}
          <button
            type="button"
            onclick={() => (composeColor = c.id)}
            class="h-6 w-6 rounded-full {c.swatch} ring-offset-2 ring-offset-zinc-950 {composeColor === c.id ? 'ring-2 ring-zinc-300' : ''}"
            aria-label={c.label}
            title={c.label}
          ></button>
        {/each}
      </div>
    </div>
    <div class="flex justify-end gap-2 pt-1">
      <button type="button" onclick={() => (composing = false)} class="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-100">Abbrechen</button>
      <button type="submit" class="rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium hover:bg-indigo-400">Posten</button>
    </div>
  </form>
</Modal>
