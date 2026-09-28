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

  // ── Zurück zur Standardwoche ─────────────────────────────────────────────
  // `toToday` setzt auf das zurück, was der Server ohne `?week=` zeigt. Am
  // Wochenende ist das die kommende Woche — dann wäre „Heute" schlicht falsch
  // beschriftet, also sagt der Knopf, wohin er wirklich führt. Die Entscheidung
  // kommt vom Server, weil er sie beim Zurücksetzen auch trifft; die Browser-Uhr
  // könnte an einem Zeitzonenrand zu einem anderen Schluss kommen.
  const defaultIsNextWeek = $derived(data.today < data.defaultWeek);
  const resetLabel = $derived(defaultIsNextWeek ? "Nächste Woche" : "Heute");
  const atDefaultWeek = $derived(data.weekStart === data.defaultWeek);

  // ── "Gerade jetzt" ───────────────────────────────────────────────────────
  // The running period has to come from the *browser's* clock: the server
  // renders once and the page then sits open for hours, and a server-side
  // "now" would also be wrong for anyone in another timezone. `now` stays null
  // until hydration so SSR and the first client render agree.
  let now = $state<Date | null>(null);
  $effect(() => {
    const tick = () => (now = new Date());
    tick();
    // A minute's granularity is all a period boundary needs; 30s keeps the
    // switch from lagging visibly.
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  });

  const blocks = $derived(data.configured ? data.blocks : []);
  /** Today per the browser, so the highlight survives midnight on an open tab. */
  const todayLocal = $derived(
    now
      ? new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
      : data.today,
  );
  const toMinutes = (hhmm: string) => {
    const [h, m] = hhmm.split(":");
    return Number(h) * 60 + Number(m);
  };
  /**
   * Index of the block the clock currently sits in, or -1.
   *
   * HTML exports publish period numbers and no times, so there is nothing to
   * compare against there — those simply never highlight.
   */
  const currentBlock = $derived.by(() => {
    if (!now) return -1;
    const mins = now.getHours() * 60 + now.getMinutes();
    return blocks.findIndex((b) => b.start && b.end && toMinutes(b.start) <= mins && mins < toMinutes(b.end));
  });
  /** Only meaningful while today is one of the columns on screen. */
  const showsToday = $derived(todayLocal >= data.weekStart && todayLocal <= data.weekEnd);
  /**
   * Minutes left in the running block.
   *
   * More useful than a bare "jetzt": the question in a corridor is not whether
   * a lesson is running but how long it still is. Rounded up so the last
   * seconds read "noch 1 min" rather than "noch 0 min".
   */
  const remainingMin = $derived.by(() => {
    if (!now || currentBlock < 0) return null;
    const end = blocks[currentBlock]?.end;
    if (!end) return null;
    const mins = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    return Math.max(1, Math.ceil(toMinutes(end) - mins));
  });
  const isNow = (date: string, bi: number) => date === todayLocal && bi === currentBlock;

  /** Heutige Spalte, sofern sie in der angezeigten Woche liegt. */
  const todayDay = $derived(data.configured ? data.days.find((d) => d.date === todayLocal) : undefined);
  /**
   * Wie weit im Voraus die nächste Stunde angekündigt wird.
   *
   * Das Badge ist für den Weg zum nächsten Raum gedacht, nicht als Tagesplan:
   * „in 124 min" ist nichts, wonach jemand handelt. Bei einer längeren Lücke
   * geht dadurch nichts verloren — sobald sie auf eine Stunde zusammenschmilzt,
   * taucht das Badge von selbst auf und steht dann volle 60 Minuten.
   */
  const LEAD_MIN = 60;

  /**
   * Die nächste Stunde des heutigen Tages — unabhängig davon, wie weit sie weg
   * ist. Erst die Anzeige entscheidet über den Vorlauf, damit die Regel an
   * einer Stelle steht und nicht in der Suche versteckt ist.
   *
   * Blöcke, in denen heute nichts liegt, zählen nicht: das Badge hängt an einer
   * Karte, und in einer Freistunde gibt es keine, an der es hängen könnte.
   */
  const nextBlock = $derived.by(() => {
    if (!now || !todayDay) return -1;
    const mins = now.getHours() * 60 + now.getMinutes();
    let best = -1;
    let bestStart = Number.POSITIVE_INFINITY;
    blocks.forEach((b, i) => {
      if (!b.start || !todayDay.cells[i]) return;
      const start = toMinutes(b.start);
      if (start > mins && start < bestStart) {
        best = i;
        bestStart = start;
      }
    });
    return best;
  });

  /** Minuten bis zur nächsten Stunde, oder null wenn es keine mehr gibt. */
  const untilNextMin = $derived.by(() => {
    if (!now || nextBlock < 0) return null;
    const start = blocks[nextBlock]?.start;
    if (!start) return null;
    const mins = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    return Math.max(1, Math.ceil(toMinutes(start) - mins));
  });

  /**
   * Angekündigt wird nur, wenn gerade keine Stunde läuft — die trägt bereits
   * ihre Restzeit — und die nächste innerhalb des Vorlaufs liegt.
   */
  const upcomingBlock = $derived(
    currentBlock < 0 && untilNextMin !== null && untilNextMin <= LEAD_MIN ? nextBlock : -1,
  );
  const untilMin = $derived(upcomingBlock < 0 ? null : untilNextMin);
  const isNext = (date: string, bi: number) => date === todayLocal && bi === upcomingBlock;
  /** "" | "now" | "next" — was die Karte über ihren Zeitbezug weiß. */
  const phaseOf = (date: string, bi: number): "" | "now" | "next" =>
    isNow(date, bi) ? "now" : isNext(date, bi) ? "next" : "";

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

{#snippet lesson(e: DaVinciEntry, phase: "" | "now" | "next" = "")}
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
      {#if phase === "now" && remainingMin !== null}
        <span class="shrink-0 rounded bg-indigo-500/15 px-1.5 py-0.5 text-[10px] font-medium text-indigo-300">
          noch {remainingMin} min
        </span>
      {:else if phase === "next" && untilMin !== null}
        <span class="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300">
          in {untilMin} min
        </span>
      {:else if !data.filter?.classCode && e.classes.length}
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
      class="flex-1 rounded-md border border-zinc-800 px-3 py-1.5 text-sm transition
        {atDefaultWeek
          ? 'cursor-default text-zinc-500'
          : 'text-zinc-300 hover:bg-zinc-800'}"
      onclick={toToday}
      disabled={atDefaultWeek}
      title={defaultIsNextWeek
        ? "Zur kommenden Woche — die laufende ist vorbei"
        : "Zur laufenden Woche"}
    >
      {resetLabel}
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
          href="/settings?tab=timetable"
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
        <a href="/settings?tab=timetable" class="text-sm text-rose-200 underline">Einstellungen prüfen</a>
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
          <section class="mb-4 rounded-2xl border bg-zinc-900/40 p-3 {day.date === todayLocal ? 'border-indigo-500/60' : 'border-zinc-800'}">
            <header class="mb-2 flex items-baseline justify-between">
              <h2 class="text-sm font-semibold {day.date === todayLocal ? 'text-indigo-300' : 'text-zinc-200'}">
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
                    {@const phase = phaseOf(day.date, bi)}
                    <li class="flex items-start gap-2">
                      <div class="flex w-12 shrink-0 flex-col items-start pt-1.5">
                        {#if block.period}
                          <span
                            class="rounded px-1.5 py-0.5 text-[11px] font-medium {phase === 'now'
                              ? 'bg-indigo-500/20 text-indigo-200'
                              : 'bg-zinc-800 text-zinc-300'}"
                          >{block.period}</span>
                        {/if}
                        <!-- HTML-Exporte veröffentlichen nur Stundennummern. -->
                        {#if block.start}
                          <span class="mt-1 text-[10px] leading-tight {phase === 'now' ? 'text-indigo-300' : 'text-zinc-500'}">{block.start}</span>
                          <span class="text-[10px] leading-tight {phase === 'now' ? 'text-indigo-400/70' : 'text-zinc-600'}">{block.end}</span>
                        {/if}
                      </div>
                      <div
                        class="grid min-w-0 flex-1 gap-2 {cell.parallel ? 'grid-cols-2' : 'grid-cols-1'}
                          {phase === 'now' ? 'rounded-xl ring-2 ring-indigo-400/70' : ''}
                          {phase === 'next' ? 'rounded-xl ring-1 ring-zinc-600' : ''}"
                      >
                        {#each cell.entries as e (e.key)}{@render lesson(e, phase)}{/each}
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
            {@const isToday = day.date === todayLocal}
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
            {@const nowRow = showsToday && bi === currentBlock}
            <div class="flex flex-col items-end justify-start pt-2 pr-1 text-right whitespace-nowrap">
              {#if block.period}
                <span
                  class="rounded px-1.5 py-0.5 text-[11px] font-medium {nowRow
                    ? 'bg-indigo-500/20 text-indigo-200'
                    : 'bg-zinc-800 text-zinc-300'}"
                >
                  {block.period}
                </span>
              {/if}
              {#if block.start}
                <span class="mt-1 text-[10px] leading-tight {nowRow ? 'text-indigo-300' : 'text-zinc-500'}">{block.start}</span>
                <span class="text-[10px] leading-tight {nowRow ? 'text-indigo-400/70' : 'text-zinc-600'}">{block.end}</span>
              {/if}
            </div>

            {#each data.days as day (day.date)}
              {@const cell = day.cells[bi]}
              <!-- The accent lands on the one cell where "now" actually is —
                   today's column in the running period — so the eye goes to
                   the lesson, not to the whole row. -->
              {@const phase = phaseOf(day.date, bi)}
              {#if cell}
                <div
                  class="grid gap-2 {cell.parallel ? 'grid-cols-2' : 'grid-cols-1'}
                    {phase === 'now' ? 'rounded-xl ring-2 ring-indigo-400/70' : ''}
                    {phase === 'next' ? 'rounded-xl ring-1 ring-zinc-600' : ''}"
                >
                  {#each cell.entries as e (e.key)}{@render lesson(e, phase)}{/each}
                </div>
              {:else}
                <div
                  class="rounded-xl border border-dashed {phase === 'now'
                    ? 'border-indigo-500/40 bg-indigo-500/5'
                    : 'border-zinc-900'}"
                ></div>
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
          href="/settings?tab=timetable"
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
          href="/settings?tab=timetable"
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
