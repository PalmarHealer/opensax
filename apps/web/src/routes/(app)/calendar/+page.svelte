<script lang="ts">
  import { enhance } from "$app/forms";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import Icon from "$lib/Icon.svelte";
  import Modal from "$lib/Modal.svelte";

  let { data } = $props();
  const groups = $derived((page.data.groups as Array<{ login: string; effective_rights?: string[]; member_rights?: string[] }>) ?? []);
  const canWrite = $derived.by(() => {
    if (!data.group) return true;
    const g = groups.find((g) => g.login === data.group);
    if (!g) return false;
    const rights = [...(g.effective_rights ?? []), ...(g.member_rights ?? [])];
    return rights.includes("calendar_admin") || rights.includes("calendar_write") || rights.includes("calendar");
  });

  const MONTH_NAMES = [
    "Januar","Februar","März","April","Mai","Juni",
    "Juli","August","September","Oktober","November","Dezember",
  ];
  const WEEKDAYS = ["Mo","Di","Mi","Do","Fr","Sa","So"];

  function monthGrid(year: number, month0: number): Date[] {
    const first = new Date(year, month0, 1);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(year, month0, 1 - offset);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }

  function bucketByDay(entries: { id: string; title: string; start_date: number; end_date: number; is_all_day?: 0 | 1; is_global?: 0 | 1 }[]) {
    const map = new Map<string, typeof entries>();
    for (const e of entries) {
      const startDay = startOfDay(e.start_date * 1000);
      const endDay = startOfDay((e.end_date - 1) * 1000);
      for (let t = startDay.getTime(); t <= endDay.getTime(); t += 86400_000) {
        const key = isoDay(new Date(t));
        const arr = map.get(key) ?? [];
        arr.push(e);
        map.set(key, arr);
      }
    }
    return map;
  }
  function startOfDay(ms: number): Date {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  function isoDay(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  const grid = $derived(monthGrid(data.year, data.month0));
  const entriesByDay = $derived(bucketByDay(data.entries));
  const holidaysByDay = $derived(bucketByDay(data.holidays));

  const today = new Date();
  const todayKey = isoDay(today);

  function ymStr(year: number, month0: number): string {
    return `${year}-${String(month0 + 1).padStart(2, "0")}`;
  }
  function navMonth(deltaMonths: number) {
    const d = new Date(data.year, data.month0 + deltaMonths, 1);
    const u = new URL(page.url);
    u.searchParams.set("ym", ymStr(d.getFullYear(), d.getMonth()));
    goto(u.pathname + u.search);
  }
  function navToday() {
    const u = new URL(page.url);
    u.searchParams.delete("ym");
    goto(u.pathname + u.search);
  }

  let showCreate = $state(false);
  let createDate = $state(todayKey);
  const groupValue = $derived(data.group ?? "");

  // ── Mobile: Tagesauswahl ─────────────────────────────────────────────────
  // `picked` ist nur die *Absicht* des Nutzers; welcher Tag tatsächlich gilt,
  // leitet sich daraus plus dem angezeigten Monat ab. Damit fällt die Auswahl
  // beim Monatswechsel von selbst auf einen Tag im neuen Monat zurück, ohne
  // einen Effect, der seinen eigenen State zurückschreibt.
  const monthKey = $derived(`${data.year}-${String(data.month0 + 1).padStart(2, "0")}`);
  let picked = $state<string | null>(null);
  const selectedKey = $derived.by(() => {
    if (picked && picked.startsWith(monthKey)) return picked;
    return todayKey.startsWith(monthKey) ? todayKey : `${monthKey}-01`;
  });
  const selectedEntries = $derived(entriesByDay.get(selectedKey) ?? []);
  const selectedHoliday = $derived(holidaysByDay.get(selectedKey)?.[0]);

  const fmtDayLong = (key: string) =>
    new Date(`${key}T00:00:00`).toLocaleDateString("de-DE", {
      weekday: "long", day: "2-digit", month: "long",
    });
  /** „Ganztägig" oder die Uhrzeitspanne; mehrtägige Termine nennen das Enddatum. */
  function timeLabel(e: { start_date: number; end_date: number; is_all_day?: 0 | 1 }): string {
    const start = new Date(e.start_date * 1000);
    const end = new Date(e.end_date * 1000);
    const hhmm = (d: Date) => d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    const spansDays = isoDay(start) !== isoDay(new Date((e.end_date - 1) * 1000));
    if (e.is_all_day) return spansDays ? `Ganztägig bis ${isoDay(new Date((e.end_date - 1) * 1000)).split("-").reverse().join(".")}` : "Ganztägig";
    return spansDays ? `${hhmm(start)} – ${hhmm(end)} (mehrtägig)` : `${hhmm(start)} – ${hhmm(end)}`;
  }
</script>

<div class="grid h-full" style="grid-template-rows: auto 1fr">
  <header class="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-950/80 px-4 py-3 md:gap-3 md:px-6">
    <div class="flex items-center gap-2">
      <button onclick={() => navMonth(-1)} class="grid h-8 w-8 place-items-center rounded-md border border-zinc-800 bg-zinc-900 hover:bg-zinc-800" aria-label="Vorheriger Monat">
        <Icon name="chevron-left" size={16} />
      </button>
      <button onclick={navToday} class="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm hover:bg-zinc-800">Heute</button>
      <button onclick={() => navMonth(1)} class="grid h-8 w-8 place-items-center rounded-md border border-zinc-800 bg-zinc-900 hover:bg-zinc-800" aria-label="Nächster Monat">
        <Icon name="chevron-right" size={16} />
      </button>
      <h1 class="ml-1 text-base font-semibold tracking-tight md:ml-3 md:text-lg">{MONTH_NAMES[data.month0]} {data.year}</h1>
    </div>
    {#if canWrite && !data.permissionError}
      <button
        onclick={() => { showCreate = true; createDate = todayKey; }}
        class="flex items-center gap-1.5 rounded-md bg-indigo-500 px-2.5 py-1.5 text-sm font-medium text-white hover:bg-indigo-400 md:px-3"
        aria-label="Termin anlegen"
      ><Icon name="plus" size={16} /><span class="hidden sm:inline">Termin</span></button>
    {/if}
  </header>

  <section class="overflow-hidden">
    {#if data.permissionError}
      <div class="grid h-full place-items-center p-6">
        <div class="max-w-sm rounded-2xl border border-amber-500/30 bg-amber-500/5 px-6 py-8 text-center">
          <div class="mx-auto mb-3 inline-grid h-10 w-10 place-items-center rounded-full bg-amber-500/15 text-amber-300">
            <Icon name="calendar" size={20} />
          </div>
          <p class="text-sm font-medium text-amber-200">Keine Kalender-Berechtigung in dieser Gruppe.</p>
        </div>
      </div>
    {:else}
    <div class="flex h-full min-h-0 flex-col md:hidden">
      <div class="grid shrink-0 grid-cols-7 border-b border-zinc-800 bg-zinc-900/30">
        {#each WEEKDAYS as wd}
          <div class="py-1 text-center text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{wd}</div>
        {/each}
      </div>

      <!-- Der Monat als Wähler: Zahl plus Punkte statt Titeln. Was an einem Tag
           liegt, liest man in der Agenda darunter — im Raster wäre es auf
           390px ohnehin nur ein abgeschnittenes Wort. -->
      <div class="grid shrink-0 grid-cols-7 gap-px border-b border-zinc-800 bg-zinc-900">
        {#each grid as d}
          {@const inMonth = d.getMonth() === data.month0}
          {@const key = isoDay(d)}
          {@const dayEntries = entriesByDay.get(key) ?? []}
          {@const holiday = holidaysByDay.get(key)?.[0]}
          <button
            class="flex aspect-square flex-col items-center justify-center gap-1 bg-zinc-950 transition
              {inMonth ? 'text-zinc-200' : 'text-zinc-700'}
              {key === selectedKey ? 'bg-indigo-500/15 ring-1 ring-inset ring-indigo-400' : ''}"
            aria-pressed={key === selectedKey}
            aria-label="{d.getDate()}. — {dayEntries.length} Termine"
            onclick={() => (picked = key)}
          >
            <span class="text-xs font-semibold {key === todayKey ? 'text-indigo-300' : ''}">{d.getDate()}</span>
            <span class="flex h-1 items-center gap-0.5">
              {#if holiday}
                <span class="h-1 w-1 rounded-full bg-amber-400"></span>
              {/if}
              {#each dayEntries.slice(0, 3) as e (e.id)}
                <span class="h-1 w-1 rounded-full bg-indigo-400"></span>
              {/each}
            </span>
          </button>
        {/each}
      </div>

      <div class="min-h-0 flex-1 overflow-auto p-3">
        <div class="mb-2 flex items-center justify-between gap-2">
          <h2 class="text-sm font-semibold text-zinc-200">{fmtDayLong(selectedKey)}</h2>
          {#if canWrite}
            <button
              class="shrink-0 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
              onclick={() => { showCreate = true; createDate = selectedKey; }}
            >+ Termin</button>
          {/if}
        </div>

        {#if selectedHoliday}
          <p class="mb-2 inline-block rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300">
            {selectedHoliday.title}
          </p>
        {/if}

        {#if selectedEntries.length === 0}
          <p class="py-6 text-center text-xs text-zinc-600">Keine Termine.</p>
        {:else}
          <ul class="space-y-2">
            {#each selectedEntries as e (e.id)}
              <li class="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
                <p class="text-sm font-medium break-words text-zinc-100">{e.title}</p>
                <p class="mt-0.5 text-xs text-zinc-500">{timeLabel(e)}</p>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>

    <!-- Unterhalb `md` ist das 6×7-Raster mit Text-Chips unbrauchbar: die Zeilen
         werden ~260px hoch, die letzte Woche wird abgeschnitten, und die meisten
         Zellen bleiben leer. Darunter steht deshalb ein kompakter Monatswähler
         mit einer Agenda für den angetippten Tag — dieselbe Information auf
         einem Drittel der Höhe. Beide Varianten werden gerendert und per CSS
         umgeschaltet, wie im Stundenplan: ein JS-Breakpoint müsste beim SSR
         raten. -->
    <div class="hidden h-full md:grid" style="grid-template-rows: auto 1fr">
      <div class="grid grid-cols-7 border-b border-zinc-800 bg-zinc-900/30">
        {#each WEEKDAYS as wd}
          <div class="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">{wd}</div>
        {/each}
      </div>

      <div class="grid grid-cols-7 grid-rows-6 divide-x divide-y divide-zinc-900">
        {#each grid as d}
          {@const inMonth = d.getMonth() === data.month0}
          {@const key = isoDay(d)}
          {@const dayEntries = entriesByDay.get(key) ?? []}
          {@const holiday = holidaysByDay.get(key)?.[0]}
          <button
            class="group flex min-w-0 flex-col items-stretch gap-1 p-1 text-left transition hover:bg-zinc-900/40 md:px-2 md:py-1.5
              {inMonth ? '' : 'bg-zinc-950/60 text-zinc-600'}
              {key === todayKey ? 'bg-indigo-500/10' : ''}"
            disabled={!canWrite}
            onclick={() => { if (canWrite) { showCreate = true; createDate = key; } }}
          >
            <div class="flex min-w-0 items-center justify-between gap-1">
              <span class="text-[10px] font-semibold md:text-xs {key === todayKey ? 'text-indigo-300' : ''}">{d.getDate()}</span>
              {#if holiday}
                <span class="min-w-0 truncate rounded-full bg-amber-500/10 px-1.5 text-[9px] font-medium text-amber-300 md:text-[10px]" title={holiday.title}>{holiday.title}</span>
              {/if}
            </div>
            <div class="min-w-0 space-y-0.5">
              {#each dayEntries.slice(0, 3) as e}
                <div class="truncate rounded bg-indigo-500/15 px-1 py-0.5 text-[10px] font-medium text-indigo-200 md:px-1.5 md:text-[11px]" title={e.title}>{e.title}</div>
              {/each}
              {#if dayEntries.length > 3}
                <div class="text-[10px] text-zinc-500">+{dayEntries.length - 3} weitere</div>
              {/if}
            </div>
          </button>
        {/each}
      </div>
    </div>
    {/if}
  </section>
</div>

<Modal open={showCreate} onclose={() => (showCreate = false)} title="Neuer Termin">
  <form
    method="POST"
    action="?/create"
    use:enhance={() => async ({ update }) => { await update(); showCreate = false; }}
    class="space-y-3"
  >
    <input type="hidden" name="group" value={groupValue} />
    <label class="block">
      <span class="mb-1 block text-xs font-medium text-zinc-400">Titel</span>
      <input name="title" required class="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
    </label>
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label class="block">
        <span class="mb-1 block text-xs font-medium text-zinc-400">Start</span>
        <input name="start" type="datetime-local" required value="{createDate}T09:00" class="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
      </label>
      <label class="block">
        <span class="mb-1 block text-xs font-medium text-zinc-400">Ende</span>
        <input name="end" type="datetime-local" value="{createDate}T10:00" class="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
      </label>
    </div>
    <label class="flex items-center gap-2 text-sm text-zinc-300">
      <input type="checkbox" name="all_day" value="true" />
      Ganztägig
    </label>
    <label class="block">
      <span class="mb-1 block text-xs font-medium text-zinc-400">Ort</span>
      <input name="location" class="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
    </label>
    <label class="block">
      <span class="mb-1 block text-xs font-medium text-zinc-400">Beschreibung</span>
      <textarea name="description" rows="3" class="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-indigo-500"></textarea>
    </label>
    <div class="flex justify-end gap-2 pt-2">
      <button type="button" onclick={() => (showCreate = false)} class="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-100">Abbrechen</button>
      <button type="submit" class="rounded-md bg-indigo-500 px-4 py-1.5 text-sm font-medium hover:bg-indigo-400">Anlegen</button>
    </div>
  </form>
</Modal>
