<script lang="ts">
  import { page } from "$app/state";
  import Icon from "$lib/Icon.svelte";
  import { getGreeting } from "$lib/greeting";

  let { data } = $props();
  const displayName = $derived(page.data.displayName as string | undefined);
  const firstName = $derived((displayName ?? "").split(" ")[0] || "");

  function fmtRelative(ts: number | undefined): string {
    if (!ts) return "";
    const d = new Date(ts * 1000);
    const now = new Date();
    const dayDiff = Math.floor((d.getTime() - now.getTime()) / 86400_000);
    if (Math.abs(dayDiff) < 1 && d.toDateString() === now.toDateString()) {
      return `heute, ${d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`;
    }
    if (dayDiff === 1) return `morgen, ${d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`;
    if (dayDiff > 1 && dayDiff < 7) return `${d.toLocaleDateString("de-DE", { weekday: "long" })}, ${d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`;
    return d.toLocaleDateString("de-DE", { dateStyle: "medium" });
  }

  function fmtDue(ts: number | undefined): string {
    if (!ts) return "";
    const d = new Date(ts * 1000);
    const now = new Date();
    const days = Math.floor((d.getTime() - now.getTime()) / 86400_000);
    if (days < 0) return `${-days}d überfällig`;
    if (days === 0) return "heute";
    if (days === 1) return "morgen";
    if (days < 7) return `in ${days}d`;
    return d.toLocaleDateString("de-DE", { dateStyle: "medium" });
  }

  const greeting = $derived(getGreeting(firstName));
</script>

<div class="mx-auto max-w-6xl px-8 py-8">
  <header class="mb-8">
    <h1 class="text-3xl font-semibold tracking-tight">{greeting}</h1>
    <p class="mt-1 text-sm text-zinc-400">
      {#if data.unreadCount > 0}{data.unreadCount} ungelesene Mail{data.unreadCount === 1 ? "" : "s"}{/if}
      {#if data.unreadCount > 0 && data.openTasks.length > 0} · {/if}
      {#if data.openTasks.length > 0}{data.openTasks.length} offene Aufgabe{data.openTasks.length === 1 ? "" : "n"}{/if}
      {#if data.unreadCount === 0 && data.openTasks.length === 0}Keine offenen Punkte.{/if}
    </p>
  </header>

  <div class="grid gap-4 lg:grid-cols-3">
    <!-- Upcoming events -->
    <section class="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 lg:col-span-2 lg:row-span-2">
      <header class="mb-4 flex items-center justify-between">
        <h2 class="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
          <Icon name="calendar" size={16} /> Anstehend
        </h2>
        <a href="/calendar" class="text-xs text-indigo-400 hover:text-indigo-300">Kalender →</a>
      </header>
      {#if data.upcoming.length === 0}
        <p class="py-8 text-center text-sm text-zinc-500">Nichts in den kommenden Tagen.</p>
      {:else}
        <ul class="space-y-2">
          {#each data.upcoming as e}
            <li class="flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2.5">
              <div class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-indigo-500/15 text-indigo-300">
                <Icon name="calendar" size={16} />
              </div>
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">{e.title}</p>
                <p class="text-xs text-zinc-500">
                  {fmtRelative(e.start_date)}{e._group ? ` · ${e._group}` : ""}{e.location ? ` · ${e.location}` : ""}
                </p>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <!-- Unread mails -->
    <section class="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
      <header class="mb-3 flex items-center justify-between">
        <h2 class="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
          <Icon name="mail" size={16} /> Ungelesen
        </h2>
        <span class="rounded-full bg-indigo-500/15 px-2 py-0.5 text-xs font-medium text-indigo-300">{data.unreadCount}</span>
      </header>
      {#if data.unread.length === 0}
        <p class="py-4 text-center text-sm text-zinc-500">Inbox ist leer.</p>
      {:else}
        <ul class="space-y-2">
          {#each data.unread as m}
            <li class="rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-sm">
              <p class="truncate font-medium">{m.subject ?? "(kein Betreff)"}</p>
              <p class="truncate text-xs text-zinc-500">{m.from?.[0]?.name ?? m.from?.[0]?.addr ?? ""}</p>
            </li>
          {/each}
        </ul>
      {/if}
      <a href="/mail" class="mt-3 inline-block text-xs text-indigo-400 hover:text-indigo-300">Postfach →</a>
    </section>

    <!-- Open tasks -->
    <section class="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
      <header class="mb-3 flex items-center justify-between">
        <h2 class="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
          <Icon name="list-check" size={16} /> Offene Aufgaben
        </h2>
        <a href="/tasks" class="text-xs text-indigo-400 hover:text-indigo-300">Alle →</a>
      </header>
      {#if data.openTasks.length === 0}
        <p class="py-4 text-center text-sm text-zinc-500">Keine offenen Aufgaben.</p>
      {:else}
        <ul class="space-y-2">
          {#each data.openTasks.slice(0, 5) as t}
            <li class="rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-sm">
              <p class="truncate font-medium">{t.title}</p>
              <p class="text-xs text-zinc-500">
                {t._group}{t.due_date ? ` · ${fmtDue(t.due_date)}` : ""}
              </p>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <!-- Notifications -->
    <section class="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 lg:col-span-3">
      <header class="mb-3 flex items-center justify-between">
        <h2 class="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
          <Icon name="bell" size={16} /> System
        </h2>
      </header>
      {#if data.notifications.length === 0}
        <p class="py-4 text-center text-sm text-zinc-500">Nichts Neues.</p>
      {:else}
        <ul class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {#each data.notifications as n}
            <li class="rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-xs">
              <p class="truncate font-medium text-zinc-200">{n.message_hr ?? n.id}</p>
              <p class="text-zinc-500">{fmtRelative(Number.parseInt(n.date, 10))}</p>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>
</div>
