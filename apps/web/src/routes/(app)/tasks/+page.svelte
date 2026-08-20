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
    return rights.includes("tasks_write") || rights.includes("tasks") || rights.includes("tasks_admin");
  });

  function fmt(ts: number | undefined) {
    if (!ts) return "";
    return new Date(ts * 1000).toLocaleDateString("de-DE", { dateStyle: "medium" });
  }
</script>

<div class="grid h-full" style="grid-template-rows: auto 1fr">
  <header class="flex items-center justify-between border-b border-zinc-800 bg-zinc-950/80 px-6 py-3">
    <h1 class="text-lg font-semibold tracking-tight">Aufgaben</h1>
  </header>

  <section class="overflow-auto px-6 py-6">
    <div class="mx-auto max-w-3xl">
      {#if data.permissionError}
        <div class="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
          Keine Aufgaben-Berechtigung in dieser Gruppe.
        </div>
      {/if}

      {#if canWrite && !data.permissionError}
        <form method="POST" action="?/create" use:enhance class="mb-6 flex flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 md:flex-row md:items-center">
          <input type="hidden" name="group" value={groupValue} />
          <input
            name="title"
            type="text"
            placeholder="Neue Aufgabe…"
            required
            class="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500"
          />
          <input
            name="due_date"
            type="date"
            class="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500 md:w-auto"
          />
          <button class="w-full rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium hover:bg-indigo-400 md:w-auto">Anlegen</button>
        </form>
      {/if}

      <ul class="space-y-1">
        {#each data.tasks as t}
          <li class="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/30 px-3 py-2">
            <form method="POST" action="?/toggle" use:enhance class="flex">
              <input type="hidden" name="id" value={t.id} />
              <input type="hidden" name="completed" value={(!t.completed).toString()} />
              <input type="hidden" name="group" value={groupValue} />
              <button
                type="submit"
                disabled={!canWrite}
                class="grid h-5 w-5 place-items-center rounded border transition
                  {t.completed ? 'border-indigo-500 bg-indigo-500' : 'border-zinc-700 hover:border-zinc-500'}
                  disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Toggle"
              >
                {#if t.completed}<span class="text-xs text-white">✓</span>{/if}
              </button>
            </form>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm {t.completed ? 'text-zinc-500 line-through' : 'text-zinc-100'}">{t.title}</p>
              {#if t.due_date}<p class="text-xs text-zinc-500">fällig {fmt(t.due_date)}</p>{/if}
            </div>
            {#if canWrite}
              <form method="POST" action="?/remove" use:enhance>
                <input type="hidden" name="id" value={t.id} />
                <input type="hidden" name="group" value={groupValue} />
                <button type="submit" class="text-zinc-500 hover:text-red-400" aria-label="Löschen">
                  <Icon name="trash" size={14} />
                </button>
              </form>
            {/if}
          </li>
        {:else}
          <li class="rounded-lg border border-dashed border-zinc-800 px-6 py-12 text-center text-sm text-zinc-500">
            Keine Aufgaben.
          </li>
        {/each}
      </ul>
    </div>
  </section>
</div>
