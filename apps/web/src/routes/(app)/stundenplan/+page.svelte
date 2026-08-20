<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import Icon from "$lib/Icon.svelte";
  import type { DaVinciEntry } from "@lernsax/core";

  let { data } = $props();

  const DAY_NAMES = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
  const DAY_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

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

{#snippet lesson(e: DaVinciEntry)}
  <div
    class="h-full min-w-0 overflow-hidden rounded-xl border p-2.5 {e.change
      ? CHANGE_STYLE[e.change.type]
      : 'border-zinc-800 bg-zinc-950/40'}"
  >
    <div class="flex items-baseline justify-between gap-1">
      <span
        class="min-w-0 break-words text-sm font-medium {e.change?.type === 'cancelled'
          ? 'text-zinc-500 line-through'
          : 'text-zinc-100'}"
      >
        {e.title}
      </span>
      <!-- Which class this belongs to only matters when the view isn't already
           narrowed to one — an unfiltered HTML export lists the whole school. -->
      {#if !data.filter?.classCode && e.classes.length}
        <span class="shrink-0 rounded bg-zinc-800 px-1 py-0.5 text-[10px] text-zinc-400">
          {e.classes.join(", ")}
        </span>
      {/if}
    </div>

    <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-400">
      {#if e.rooms.length}
        <span class="inline-flex items-center gap-1"><Icon name="map-pin" size={12} />{e.rooms.join(", ")}</span>
      {/if}
      {#if e.teachers.length}
        <span class="inline-flex items-center gap-1"><Icon name="user" size={12} />{e.teachers.join(", ")}</span>
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
        <p class="mt-1 text-[11px] leading-snug text-zinc-400">{e.change.information || e.change.message}</p>
      {/if}
    {/if}
  </div>
{/snippet}

{#snippet blockLabel(block: { period?: string; start: string; end: string })}
  {#if block.period}
    <span class="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] font-medium text-zinc-300">{block.period}</span>
  {/if}
  <!-- HTML exports publish period numbers only; there are no times. -->
  {#if block.start}
    <span class="text-[11px] text-zinc-500">{block.start}–{block.end}</span>
  {/if}
{/snippet}

{#snippet controls()}
  <div class="flex items-center gap-1">
    <button
      class="rounded-md border border-zinc-800 p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
      onclick={() => shiftWeek(-7)}
      aria-label="Vorherige Woche"
    >
      <Icon name="chevron-left" size={16} />
    </button>
    <button
      class="flex-1 rounded-md border border-zinc-800 px-3 py-1.5 text-sm text-zinc-300 transition hover:bg-zinc-800"
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
{/snippet}

{#snippet body()}
  {#if !data.configured}
    <div class="flex h-full items-center justify-center p-8">
      <div class="max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 text-center">
        <h2 class="mb-2 text-lg font-semibold">Noch kein Stundenplan verbunden</h2>
        <p class="mb-4 text-sm text-zinc-400">
          Trage den Endpoint deiner Schule ein — je nachdem, was sie veröffentlicht, ein
          DaVinci-InfoServer oder ein HTML-Vertretungsplan.
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
    <div class="flex h-full items-center justify-center p-8">
      <div class="max-w-md rounded-2xl border border-rose-900/60 bg-rose-950/20 p-6 text-center">
        <h2 class="mb-2 text-lg font-semibold text-rose-200">Abruf fehlgeschlagen</h2>
        <p class="mb-4 text-sm text-rose-300/80">{data.error}</p>
        <a href="/settings?tab=stundenplan" class="text-sm text-rose-200 underline">Einstellungen prüfen</a>
      </div>
    </div>
  {:else if data.blocks.length === 0}
    <div class="flex h-full items-center justify-center p-8">
      <p class="text-sm text-zinc-500">Keine Stunden in dieser Woche.</p>
    </div>
  {:else}
    <div class="h-full overflow-auto p-4">
      <!-- Below `md` a column-per-day grid is unreadable, so the same data is
           laid out as a list of days. Both are rendered and toggled in CSS —
           a JS breakpoint store would have to guess during SSR. -->
      <div class="md:hidden">
        {#each data.days as day, i (day.date)}
          <section class="mb-4 rounded-2xl border bg-zinc-900/40 p-3 {day.date === data.today ? 'border-indigo-500/60' : 'border-zinc-800'}">
            <header class="mb-2 flex items-baseline justify-between">
              <h2 class="text-sm font-semibold {day.date === data.today ? 'text-indigo-300' : 'text-zinc-200'}">
                {DAY_NAMES[i]}
              </h2>
              <span class="text-xs text-zinc-500">{fmtDay(day.date)}</span>
            </header>
            {#if day.note}
              <p class="mb-2 text-[11px] text-zinc-500">{day.note}</p>
            {/if}
            {#if day.cells.every((c) => c === null)}
              <p class="py-4 text-center text-xs text-zinc-600">frei</p>
            {:else}
              <ul class="space-y-3">
                {#each data.blocks as block, bi (block.start + "|" + block.end + "|" + (block.period ?? ""))}
                  {@const cell = day.cells[bi]}
                  {#if cell}
                    <li>
                      <div class="mb-1 flex items-baseline gap-2 px-0.5 whitespace-nowrap">
                        {@render blockLabel(block)}
                      </div>
                      <div class="grid gap-2 {cell.parallel ? 'grid-cols-2' : 'grid-cols-1'}">
                        {#each cell.entries as e (e.key)}{@render lesson(e)}{/each}
                      </div>
                    </li>
                  {/if}
                {/each}
              </ul>
            {/if}
          </section>
        {/each}
      </div>

      <!-- One row per time block, one column per day: the same period sits at
           the same height everywhere, so the week reads across as well as down.
           Five day columns need room — below ~830px this scrolls sideways
           inside its own container rather than squeezing the cards. -->
      <div class="hidden md:block">
        <div
          class="grid min-w-[46rem] gap-2"
          style="grid-template-columns: 4.5rem repeat({data.days.length}, minmax(0, 1fr))"
        >
          <div></div>
          {#each data.days as day, i (day.date)}
            {@const isToday = day.date === data.today}
            <div
              class="rounded-lg border px-3 py-2 {isToday
                ? 'border-indigo-500/60 bg-indigo-500/5'
                : 'border-zinc-800 bg-zinc-900/40'}"
            >
              <div class="flex items-baseline justify-between gap-1">
                <span class="truncate text-sm font-semibold {isToday ? 'text-indigo-300' : 'text-zinc-200'}">
                  <span class="hidden xl:inline">{DAY_NAMES[i]}</span>
                  <span class="xl:hidden">{DAY_SHORT[i]}</span>
                </span>
                <span class="shrink-0 text-xs text-zinc-500">{fmtDay(day.date)}</span>
              </div>
              {#if day.note}
                <p class="mt-1 truncate text-[10px] text-zinc-500" title={day.note}>{day.note}</p>
              {/if}
            </div>
          {/each}

          {#each data.blocks as block, bi (block.start + "|" + block.end + "|" + (block.period ?? ""))}
            <div class="flex flex-col items-end justify-start pt-2 pr-1 text-right whitespace-nowrap">
              {#if block.period}
                <span class="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] font-medium text-zinc-300">
                  {block.period}
                </span>
              {/if}
              {#if block.start}
                <span class="mt-1 text-[10px] leading-tight text-zinc-500">{block.start}</span>
                <span class="text-[10px] leading-tight text-zinc-600">{block.end}</span>
              {/if}
            </div>

            {#each data.days as day (day.date)}
              {@const cell = day.cells[bi]}
              {#if cell}
                <div class="grid gap-2 {cell.parallel ? 'grid-cols-2' : 'grid-cols-1'}">
                  {#each cell.entries as e (e.key)}{@render lesson(e)}{/each}
                </div>
              {:else}
                <div class="rounded-xl border border-dashed border-zinc-900"></div>
              {/if}
            {/each}
          {/each}
        </div>
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
{/snippet}

<!-- A page rail costs 240px on top of the app rail, and with a five-day grid
     next to it nothing fits below ~1300px — so the rail appears at `xl` and
     everything narrower gets the same controls as a header. -->
<div class="flex h-full flex-col xl:grid xl:grid-cols-[240px_1fr]">
  <aside class="hidden h-full flex-col gap-3 border-r border-zinc-800 bg-zinc-900/30 p-3 xl:flex">
    <h1 class="px-2 text-base font-semibold tracking-tight">Stundenplan</h1>

    {#if data.configured}
      {@render controls()}
      <p class="px-2 text-xs text-zinc-400">{weekLabel}</p>

      {#if data.filter?.classCode || data.filter?.teacherCode}
        <div class="flex flex-wrap gap-1 px-2">
          {#if data.filter.classCode}
            <span class="rounded-md bg-zinc-800 px-2 py-1 text-xs text-zinc-300">Klasse {data.filter.classCode}</span>
          {/if}
          {#if data.filter.teacherCode}
            <span class="rounded-md bg-zinc-800 px-2 py-1 text-xs text-zinc-300">{data.filter.teacherCode}</span>
          {/if}
        </div>
      {/if}

      <div class="mt-auto flex flex-col gap-1">
        <button
          class="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-200"
          onclick={refresh}
        >
          <Icon name="refresh" size={16} />
          Neu laden
        </button>
        <a
          href="/settings?tab=stundenplan"
          class="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-200"
        >
          <Icon name="settings" size={16} />
          Einstellungen
        </a>
      </div>
    {/if}
  </aside>

  <header class="shrink-0 border-b border-zinc-800 bg-zinc-900/30 px-4 py-3 xl:hidden">
    <div class="flex items-center gap-2">
      <h1 class="text-base font-semibold tracking-tight">Stundenplan</h1>
      <div class="ml-auto flex items-center gap-2">
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
    </div>
    {#if data.configured}
      <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div class="w-full max-w-xs">{@render controls()}</div>
        <span class="text-xs text-zinc-400">{weekLabel}</span>
        {#if data.filter?.classCode}
          <span class="rounded-md bg-zinc-800 px-2 py-1 text-xs text-zinc-300">Klasse {data.filter.classCode}</span>
        {/if}
        {#if data.filter?.teacherCode}
          <span class="rounded-md bg-zinc-800 px-2 py-1 text-xs text-zinc-300">{data.filter.teacherCode}</span>
        {/if}
      </div>
    {/if}
  </header>

  <section class="min-h-0 flex-1 overflow-hidden">{@render body()}</section>
</div>
