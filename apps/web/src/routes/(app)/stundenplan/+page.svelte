<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import Icon from "$lib/Icon.svelte";
  import { media } from "$lib/mediaQuery.svelte";

  let { data } = $props();

  const DAY_NAMES = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

  function shiftWeek(days: number) {
    const d = new Date(`${data.weekStart}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    const u = new URL(page.url);
    u.searchParams.set("week", d.toISOString().slice(0, 10));
    u.searchParams.delete("refresh");
    goto(u.pathname + u.search, { keepFocus: true, noScroll: true });
  }

  function toToday() {
    const u = new URL(page.url);
    u.searchParams.delete("week");
    u.searchParams.delete("refresh");
    goto(u.pathname + u.search, { keepFocus: true, noScroll: true });
  }

  function refresh() {
    const u = new URL(page.url);
    u.searchParams.set("refresh", String(Date.now()));
    goto(u.pathname + u.search, { keepFocus: true, noScroll: true, invalidateAll: true });
  }

  // de-DE already appends a trailing dot to "dd.MM.", so the year has to come
  // from a formatter that includes it rather than being concatenated on.
  const fmtDay = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
  const fmtDayYear = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("de-DE", {
      day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC",
    });

  const weekLabel = $derived(`${fmtDay(data.weekStart)} – ${fmtDayYear(data.weekEnd)}`);

  /** Tailwind accents per change type — cancelled reads as "gone", not "new". */
  const CHANGE_STYLE: Record<string, string> = {
    cancelled: "border-rose-500/40 bg-rose-500/5",
    substituted: "border-amber-500/40 bg-amber-500/5",
    moved: "border-sky-500/40 bg-sky-500/5",
    extra: "border-emerald-500/40 bg-emerald-500/5",
    message: "border-violet-500/40 bg-violet-500/5",
    modified: "border-amber-500/40 bg-amber-500/5",
  };
  const BADGE_STYLE: Record<string, string> = {
    cancelled: "bg-rose-500/15 text-rose-300",
    substituted: "bg-amber-500/15 text-amber-300",
    moved: "bg-sky-500/15 text-sky-300",
    extra: "bg-emerald-500/15 text-emerald-300",
    message: "bg-violet-500/15 text-violet-300",
    modified: "bg-amber-500/15 text-amber-300",
  };
</script>

<div class="flex h-full flex-col">
  <!-- Header -->
  <header class="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-800 bg-zinc-900/30 px-4 py-3">
    <h1 class="mr-2 text-base font-semibold tracking-tight">Stundenplan</h1>

    {#if data.configured}
      <div class="flex items-center gap-1">
        <button
          class="rounded-md border border-zinc-800 p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
          onclick={() => shiftWeek(-7)}
          aria-label="Vorherige Woche"
        >
          <Icon name="chevron-left" size={16} />
        </button>
        <button
          class="rounded-md border border-zinc-800 px-3 py-1.5 text-sm text-zinc-300 transition hover:bg-zinc-800"
          onclick={toToday}
        >
          Heute
        </button>
        <button
          class="rounded-md border border-zinc-800 p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
          onclick={() => shiftWeek(7)}
          aria-label="Nächste Woche"
        >
          <Icon name="chevron-right" size={16} />
        </button>
      </div>
      <span class="text-sm text-zinc-400">{weekLabel}</span>

      <div class="ml-auto flex items-center gap-2">
        {#if data.filter?.classCode}
          <span class="rounded-md bg-zinc-800 px-2 py-1 text-xs text-zinc-300">Klasse {data.filter.classCode}</span>
        {/if}
        {#if data.filter?.teacherCode}
          <span class="rounded-md bg-zinc-800 px-2 py-1 text-xs text-zinc-300">{data.filter.teacherCode}</span>
        {/if}
        <button
          class="rounded-md border border-zinc-800 p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
          onclick={refresh}
          aria-label="Neu laden"
        >
          <Icon name="refresh" size={16} />
        </button>
        <a
          href="/settings?tab=stundenplan"
          class="rounded-md border border-zinc-800 p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
          aria-label="Einstellungen"
        >
          <Icon name="settings" size={16} />
        </a>
      </div>
    {/if}
  </header>

  {#if !data.configured}
    <div class="flex flex-1 items-center justify-center p-8">
      <div class="max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 text-center">
        <h2 class="mb-2 text-lg font-semibold">Noch kein Stundenplan verbunden</h2>
        <p class="mb-4 text-sm text-zinc-400">
          Trage Endpoint, Benutzername und Passwort deines DaVinci-Servers ein — die Zugangsdaten
          bekommst du von deiner Schule.
        </p>
        <a
          href="/settings?tab=stundenplan"
          class="inline-flex items-center gap-2 rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium hover:bg-indigo-400"
        >
          <Icon name="settings" size={16} />
          Jetzt einrichten
        </a>
      </div>
    </div>
  {:else if data.error}
    <div class="flex flex-1 items-center justify-center p-8">
      <div class="max-w-md rounded-2xl border border-rose-900/60 bg-rose-950/20 p-6 text-center">
        <h2 class="mb-2 text-lg font-semibold text-rose-200">Abruf fehlgeschlagen</h2>
        <p class="mb-4 text-sm text-rose-300/80">{data.error}</p>
        <a href="/settings?tab=stundenplan" class="text-sm text-rose-200 underline">Einstellungen prüfen</a>
      </div>
    </div>
  {:else}
    <div class="flex-1 overflow-auto p-4">
      <div class="grid gap-3 {media.mobile ? '' : 'md:grid-cols-5'}">
        {#each data.days as day, i (day.date)}
          {@const isToday = day.date === data.today}
          <section
            class="rounded-2xl border bg-zinc-900/40 p-3 {isToday
              ? 'border-indigo-500/60'
              : 'border-zinc-800'}"
          >
            <header class="mb-2 flex items-baseline justify-between">
              <h2 class="text-sm font-semibold {isToday ? 'text-indigo-300' : 'text-zinc-200'}">
                {DAY_NAMES[i]}
              </h2>
              <span class="text-xs text-zinc-500">{fmtDay(day.date)}</span>
            </header>

            {#if day.entries.length === 0}
              <p class="py-4 text-center text-xs text-zinc-600">frei</p>
            {:else}
              <ul class="space-y-2">
                {#each day.entries as e (e.key)}
                  <li
                    class="rounded-xl border p-2.5 {e.change
                      ? CHANGE_STYLE[e.change.type]
                      : 'border-zinc-800 bg-zinc-950/40'}"
                  >
                    <div class="flex items-baseline gap-2">
                      {#if e.period}
                        <span class="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-400">
                          {e.period}
                        </span>
                      {/if}
                      <span
                        class="text-sm font-medium {e.change?.type === 'cancelled'
                          ? 'text-zinc-500 line-through'
                          : 'text-zinc-100'}"
                      >
                        {e.title}
                      </span>
                      <span class="ml-auto shrink-0 text-[11px] text-zinc-500">{e.start}–{e.end}</span>
                    </div>

                    <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-400">
                      {#if e.rooms.length}
                        <span class="inline-flex items-center gap-1">
                          <Icon name="map-pin" size={12} />{e.rooms.join(", ")}
                        </span>
                      {/if}
                      {#if e.teachers.length}
                        <span class="inline-flex items-center gap-1">
                          <Icon name="user" size={12} />{e.teachers.join(", ")}
                        </span>
                      {/if}
                      {#if e.change?.absentTeachers.length}
                        <span class="text-zinc-600 line-through">{e.change.absentTeachers.join(", ")}</span>
                      {/if}
                    </div>

                    {#if e.change}
                      <div class="mt-1.5 flex flex-wrap items-center gap-2">
                        <span class="rounded px-1.5 py-0.5 text-[11px] font-medium {BADGE_STYLE[e.change.type]}">
                          {e.change.caption}
                        </span>
                        {#if e.change.reason}
                          <span class="text-[11px] text-zinc-500">{e.change.reason}</span>
                        {/if}
                      </div>
                      {#if e.change.information || e.change.message}
                        <p class="mt-1 text-[11px] leading-snug text-zinc-400">
                          {e.change.information || e.change.message}
                        </p>
                      {/if}
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
          </section>
        {/each}
      </div>

      {#if data.info}
        <p class="mt-4 text-center text-[11px] text-zinc-600">
          {data.info.scheduleDescription ?? "Stundenplan"}
          · DaVinci {data.info.serverVersion ?? ""}
          {#if data.fetchedAt}
            · Stand {new Date(data.fetchedAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
            {data.cached ? "(Cache)" : ""}
          {/if}
        </p>
      {/if}
    </div>
  {/if}
</div>
