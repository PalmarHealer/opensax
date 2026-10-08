<script lang="ts">
  import { untrack, type Snippet } from "svelte";
  import { fly, scale } from "svelte/transition";
  import { flip } from "svelte/animate";
  import { backOut, cubicOut } from "svelte/easing";
  import Icon from "$lib/Icon.svelte";
  import WizardFrame from "$lib/WizardFrame.svelte";
  import { publicUrl } from "$lib/ConnectionsMcpUrl.svelte";
  import { motion } from "$lib/motion";
  import { NAV_TABS, loadNavConfig, saveNavConfig, tabById, mobileBottomTabs, type NavConfig, type NavMode, type NavTab } from "$lib/nav";
  import { theme, type ThemePref } from "$lib/themeStore.svelte";

  /**
   * Einrichtung nach dem ersten Login: Design, Navigations-Layout, welche
   * Tabs, Verbindung mit einem KI-Assistenten. Jede Wahl gilt sofort
   * (dieselben Speicherorte wie in den Einstellungen), „Überspringen“ ist auf
   * jedem Schritt möglich. Ob es durchlaufen wurde, merkt sich der Server pro
   * Account (/api/onboarding), damit es auf dem nächsten Gerät nicht wieder
   * erscheint.
   */
  interface Props {
    open: boolean;
    displayName?: string;
  }
  let { open, displayName = "" }: Props = $props();

  let closed = $state(false);
  const visible = $derived(open && !closed);

  const STEPS = [
    { id: "welcome", title: "Willkommen bei OpenSax" },
    { id: "theme", title: "Wie soll es aussehen?" },
    { id: "layout", title: "Wo soll die Navigation sein?" },
    { id: "tabs", title: "Welche Bereiche brauchst du?" },
    { id: "mcp", title: "OpenSax mit KI verbinden" },
    { id: "done", title: "Fertig eingerichtet" },
  ] as const;
  let stepIndex = $state(0);
  /** Richtung des letzten Schrittwechsels, damit der Inhalt von der passenden Seite hereinkommt. */
  let dir = $state<1 | -1>(1);
  const step = $derived(STEPS[stepIndex]!);
  function go(delta: 1 | -1) {
    dir = delta;
    stepIndex += delta;
  }

  let nav = $state<NavConfig>(loadNavConfig());
  $effect(() => {
    if (visible) nav = loadNavConfig();
  });

  function applyNav(next: NavConfig) {
    nav = next;
    saveNavConfig(next);
    window.dispatchEvent(new CustomEvent("lernsax:nav-changed"));
  }
  function setMode(mode: NavMode) {
    if (mode !== nav.mode) pillPos = 0;
    applyNav({ ...nav, mode });
  }
  /** Welchen Eintrag die Markierung in der ausgewählten Layout-Vorschau gerade zeigt (0–2). */
  let pillPos = $state(0);
  $effect(() => {
    if (step.id !== "layout" || motion(1) === 0) return;
    const t = setInterval(() => (pillPos = (pillPos + 1) % 3), 1300);
    return () => {
      clearInterval(t);
      pillPos = 0;
    };
  });
  function toggleTab(id: string) {
    if (nav.visible.includes(id)) {
      applyNav({ ...nav, visible: nav.visible.filter((v) => v !== id), hidden: [...nav.hidden, id] });
    } else {
      applyNav({ ...nav, hidden: nav.hidden.filter((v) => v !== id), visible: [...nav.visible, id] });
    }
  }
  function moveTab(id: string, delta: -1 | 1) {
    const list = [...nav.visible];
    const i = list.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    applyNav({ ...nav, visible: list });
  }
  /** Visible tabs in their order, then the hidden ones. */
  const tabRows = $derived([
    ...nav.visible.map((id) => tabById(id)).filter((t): t is NavTab => !!t),
    ...NAV_TABS.filter((t) => t.id !== "home" && !nav.visible.includes(t.id)),
  ]);
  /** Dieselbe Auswahl wie die Leiste unten im Layout, als Vorschau. */
  const bottomPreview = $derived(
    mobileBottomTabs(nav.visible.map((id) => tabById(id)).filter((t): t is NavTab => !!t && t.id !== "settings"), 5),
  );

  // ── KI-Verbindung ────────────────────────────────────────────────────────
  type Client = "claude" | "chatgpt" | "lechat" | "other";
  const CLIENTS: { id: Client; label: string }[] = [
    { id: "claude", label: "Claude" },
    { id: "chatgpt", label: "ChatGPT" },
    { id: "lechat", label: "Le Chat" },
    { id: "other", label: "Andere" },
  ];
  let client = $state<Client>("claude");
  let mcpUrl = $state("");
  $effect(() => {
    if (visible) mcpUrl = publicUrl("/mcp");
  });
  const cliCommand = $derived(`claude mcp add --transport http opensax ${mcpUrl}`);

  /** Welcher Wert zuletzt kopiert wurde — der Knopf zeigt kurz einen Haken. */
  let copied = $state<string | null>(null);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  /** Bleibt gesetzt: der erste Schritt der Anleitung gilt dann als erledigt. */
  let everCopied = $state(false);
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      copied = value;
      everCopied = true;
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => (copied = null), 1600);
    } catch {
      // Clipboard verweigert — der Text bleibt markierbar.
    }
  }

  async function finish(outcome: "completed" | "skipped") {
    closed = true;
    try {
      await fetch("/api/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ outcome }),
      });
    } catch {
      // Not recorded — it simply shows again on the next visit.
    }
  }

  const firstName = $derived(displayName.split(/\s+/)[0] ?? "");
  const themeLabel = $derived({ light: "Hell", dark: "Dunkel", system: "Wie dein Gerät" }[theme.pref]);

  /**
   * Der Orbit ist ein gedrehter Kreis, vertikal auf ORBIT_SQUASH gestaucht —
   * so wird er zur Ellipse. Jedes Symbol hat seinen eigenen Drehwinkel (0° =
   * oben am Logo) und dreht sich gegenläufig zurück, bleibt also aufrecht und
   * unverzerrt. Bewegt wird nur per Drehung: die rastet nicht auf ganze Pixel
   * ein, anders als kleine Verschiebungen.
   */
  const ORBIT_R = 130;
  const ORBIT_SQUASH = 0.6;
  /** Bereichs-Symbole, die im Willkommensbild um das Logo kreisen. */
  const ORBIT = NAV_TABS.filter((t) => t.id !== "home" && t.id !== "settings").slice(0, 8);
  const SLOT = 360 / ORBIT.length;
  /** Platz des letzten Symbols — so weit läuft die Spitze der Schlange. */
  const SNAKE_LEN = (ORBIT.length - 1) * SLOT;

  /**
   * Einlauf als Schlange: Fortschritt in Grad, von -SLOT bis SNAKE_LEN. Jedes
   * Symbol kommt auf den letzten SLOT Grad vor seinem Start oben aus dem Logo
   * und läuft dann im Uhrzeigersinn bis zu seinem Platz; das erste hat den
   * weitesten Weg, alle halten gleichzeitig an.
   */
  let snake = $state(-SLOT);
  let introDone = $state(false);
  function snakeAngle(i: number): number {
    const slot = i * SLOT;
    return Math.min(Math.max(snake - (SNAKE_LEN - slot), 0), slot);
  }
  function snakeOut(i: number): number {
    const slot = i * SLOT;
    return Math.min(Math.max((snake - (SNAKE_LEN - slot) + SLOT) / SLOT, 0), 1);
  }
  const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

  /** Drehung des Rings nach dem Einlauf in Grad; läuft fortlaufend weiter, damit Transitions den kurzen Weg nehmen. */
  let orbitOffset = $state(0);
  /** Während der Ring dreht, ist kein Symbol „oben“. */
  let orbitMoving = $state(false);
  /** Dauer der nächsten Drehung — ein angetipptes Symbol kommt je nach Weg schneller oder langsamer nach oben. */
  let orbitMs = $state(1100);
  const ORBIT_MOVE_MS = 1100;
  const ORBIT_HOLD_MS = 1600;
  /** Nach dem Antippen etwas länger warten, bevor der Ring wieder von selbst läuft. */
  const ORBIT_IDLE_MS = 4000;
  /** Das Symbol, das gerade oben am Logo steht. */
  const orbitTop = $derived(
    ((Math.round(-orbitOffset / SLOT) % ORBIT.length) + ORBIT.length) % ORBIT.length,
  );
  let orbitTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleOrbit(wait: number) {
    clearTimeout(orbitTimer);
    orbitTimer = setTimeout(() => turnOrbit(orbitOffset + SLOT, ORBIT_MOVE_MS, ORBIT_HOLD_MS), wait);
  }
  function turnOrbit(target: number, ms: number, thenWait: number) {
    clearTimeout(orbitTimer);
    orbitMs = ms;
    orbitMoving = true;
    orbitOffset = target;
    orbitTimer = setTimeout(() => {
      orbitMoving = false;
      scheduleOrbit(thenWait);
    }, ms);
  }
  /** Winkelabstand auf (-180, 180] gebracht. */
  const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

  // ── Symbol antippen: es dreht sich nach oben ──
  let heroWidth = $state(0);
  /** Auf schmalen Bildschirmen enger kreisen, damit nichts seitlich übersteht (Symbol 36px + etwas Luft). */
  const orbitR = $derived(heroWidth ? Math.min(ORBIT_R, Math.max(heroWidth / 2 - 24, 96)) : ORBIT_R);
  function onOrbitClick(e: MouseEvent) {
    if (!introDone) return;
    const hit = (e.target as HTMLElement).closest<HTMLElement>("[data-orbit-i]");
    if (!hit) return;
    // Auf kürzestem Weg; eine laufende Drehung nimmt die Transition von ihrer aktuellen Stellung mit.
    const diff = wrap(-Number(hit.dataset.orbitI) * SLOT - orbitOffset);
    turnOrbit(orbitOffset + diff, 450 + Math.abs(diff) * 3, ORBIT_IDLE_MS);
  }

  $effect(() => {
    if (!visible || step.id !== "welcome") return;
    if (motion(1) === 0) {
      snake = SNAKE_LEN;
      introDone = true;
      return;
    }
    let raf = 0;
    // Nicht reaktiv lesen: das Ende des Einlaufs soll den Effekt nicht neu starten.
    if (untrack(() => introDone)) {
      scheduleOrbit(ORBIT_HOLD_MS);
    } else {
      // Startet, während das Logo noch aufploppt.
      const DELAY = 120;
      const DURATION = 2200;
      const t0 = performance.now() + DELAY;
      const frame = (now: number) => {
        const p = Math.min(Math.max((now - t0) / DURATION, 0), 1);
        snake = -SLOT + easeInOut(p) * (SNAKE_LEN + SLOT);
        if (p < 1) {
          raf = requestAnimationFrame(frame);
        } else {
          introDone = true;
          scheduleOrbit(ORBIT_HOLD_MS);
        }
      };
      raf = requestAnimationFrame(frame);
    }
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(orbitTimer);
      orbitMoving = false;
    };
  });

  /** Farben der Design-Vorschau — fest, weil sie das jeweilige Design zeigen, nicht das aktive. */
  const PALETTE = {
    light: { bg: "#fafafa", side: "#e4e4e7", line: "#d4d4d8", card: "#ffffff" },
    dark: { bg: "#09090b", side: "#18181b", line: "#3f3f46", card: "#18181b" },
  };
  const THEMES: { id: ThemePref; label: string; desc: string; icon: string }[] = [
    { id: "light", label: "Hell", desc: "Heller Hintergrund, dunkle Schrift.", icon: "sun" },
    { id: "dark", label: "Dunkel", desc: "Schont die Augen am Abend.", icon: "moon" },
    { id: "system", label: "Wie mein Gerät", desc: "Wechselt mit deinem System.", icon: "device-desktop" },
  ];
</script>

{#snippet check(active: boolean)}
  {#if active}
    <span
      in:scale={{ start: 0.3, duration: motion(260), easing: backOut }}
      class="absolute right-2 top-2 z-10 grid h-5 w-5 place-items-center rounded-full bg-indigo-500 text-white shadow-lg shadow-indigo-500/30"
    >
      <Icon name="check" size={12} stroke={3} />
    </span>
  {/if}
{/snippet}

{#snippet themeMock(p: (typeof PALETTE)["light"])}
  <span class="absolute inset-0 flex gap-1.5 p-1.5" style="background: {p.bg}">
    <span class="flex w-3 flex-col gap-1 rounded-sm p-0.5" style="background: {p.side}">
      <span class="h-1.5 rounded-[2px] bg-indigo-500"></span>
      <span class="h-1.5 rounded-[2px]" style="background: {p.line}"></span>
      <span class="h-1.5 rounded-[2px]" style="background: {p.line}"></span>
    </span>
    <span class="flex flex-1 flex-col gap-1">
      <span class="h-1.5 w-2/3 rounded-full" style="background: {p.line}"></span>
      <span class="flex-1 rounded-sm p-1" style="background: {p.card}; box-shadow: inset 0 0 0 1px {p.side}">
        <span class="block h-1 w-3/4 rounded-full" style="background: {p.line}"></span>
        <span class="mt-1 block h-1 w-1/2 rounded-full" style="background: {p.line}"></span>
      </span>
    </span>
  </span>
{/snippet}

{#snippet copyField(value: string, label: string, mono = true)}
  {@const done = copied === value}
  <div class="flex items-stretch gap-2">
    <code class="min-w-0 flex-1 select-all truncate rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-xs {mono ? 'font-mono' : ''}" title={value}>{value || "—"}</code>
    <button
      type="button"
      onclick={() => copy(value)}
      aria-label={label}
      class="relative flex w-28 shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-lg px-3 text-xs font-medium text-white transition
        {done ? 'bg-emerald-600' : 'bg-indigo-500 hover:bg-indigo-400'}"
    >
      {#key done}
        <span in:fly={{ y: done ? 10 : -10, duration: motion(200), easing: cubicOut }} class="flex items-center gap-1.5">
          <Icon name={done ? "check" : "copy"} size={15} />
          {done ? "Kopiert" : "Kopieren"}
        </span>
      {/key}
    </button>
  </div>
{/snippet}

{#snippet instruction(n: number, done: boolean, body: Snippet)}
  <li class="flex gap-3">
    <span
      class="grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold transition-colors duration-300
        {done ? 'bg-emerald-500 text-white' : 'bg-zinc-800 text-zinc-300'}"
    >
      {#if done}
        <span in:scale={{ start: 0.3, duration: motion(260), easing: backOut }}><Icon name="check" size={13} stroke={3} /></span>
      {:else}
        {n}
      {/if}
    </span>
    <div class="min-w-0 flex-1 space-y-2 pt-0.5 text-sm text-zinc-300">{@render body()}</div>
  </li>
{/snippet}

{#snippet external(href: string, label: string)}
  <a {href} target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-xs text-indigo-300 hover:text-indigo-200">
    {label} in neuem Tab öffnen <Icon name="external-link" size={13} />
  </a>
{/snippet}

{#snippet footerNav()}
  {#if step.id !== "done"}
    <button type="button" onclick={() => finish("skipped")} class="rounded-md px-2 py-1.5 text-sm text-zinc-500 hover:text-zinc-200">Überspringen</button>
  {:else}
    <span></span>
  {/if}
  <div class="flex items-center gap-2">
    {#if stepIndex > 0 && step.id !== "done"}
      <button type="button" onclick={() => go(-1)} class="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-zinc-400 hover:text-zinc-100">
        <Icon name="chevron-left" size={16} /> Zurück
      </button>
    {/if}
    {#if step.id === "done"}
      <button type="button" onclick={() => finish("completed")} class="rounded-md bg-indigo-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-400">Los geht's</button>
    {:else}
      <button type="button" onclick={() => go(1)} class="group flex items-center gap-1 rounded-md bg-indigo-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-400">
        {step.id === "welcome" ? "Einrichten" : step.id === "mcp" ? (everCopied ? "Weiter" : "Später") : "Weiter"}
        <Icon name="chevron-right" size={16} class="transition-transform group-hover:translate-x-0.5" />
      </button>
    {/if}
  </div>
{/snippet}

{#if visible}
  <WizardFrame
    title={step.title}
    stepCount={STEPS.length}
    {stepIndex}
    onclose={() => finish(step.id === "done" ? "completed" : "skipped")}
    closeLabel={step.id === "done" ? "Schließen" : "Onboarding überspringen"}
    scrollKey={stepIndex}
    footer={footerNav}
  >
    {#key stepIndex}
      <div
        class="space-y-4 {step.id === 'welcome' || step.id === 'done' ? 'flex min-h-full flex-col justify-center sm:block sm:min-h-0' : ''}"
        in:fly={{ x: dir * 32, duration: motion(280), easing: cubicOut }}
      >
        {#if step.id === "welcome"}
          <div
            bind:clientWidth={heroWidth}
            onclick={onOrbitClick}
            class="ob-hero relative grid h-64 w-full select-none place-items-center"
            aria-hidden="true"
          >
            <span class="ob-glow absolute h-32 w-32 rounded-full bg-indigo-500/30 blur-2xl"></span>
            <span class="absolute h-0 w-0" style="transform: scaleY({ORBIT_SQUASH})">
              {#each ORBIT as t, i}
                {@const deg = snakeAngle(i) + orbitOffset}
                {@const out = snakeOut(i)}
                {@const top = introDone && !orbitMoving && orbitTop === i}
                {@const anim = introDone ? `transition: transform ${orbitMs}ms cubic-bezier(0.65, 0, 0.35, 1);` : ""}
                <span class="absolute left-0 top-0" style="{anim} transform: rotate({deg}deg)">
                  <span class="absolute left-0 top-0" style="transform: translate(0, {-orbitR * out}px)">
                    <span
                      data-orbit-i={i}
                      class="absolute -left-[18px] -top-[18px] block h-9 w-9 {introDone ? 'cursor-pointer' : ''}"
                      style="{anim} transform: rotate({-deg}deg) scaleY({1 / ORBIT_SQUASH}) scale({0.4 + 0.6 * out}); opacity: {out > 0 ? 1 : 0}"
                    >
                      <span
                        class="grid h-9 w-9 place-items-center rounded-xl border shadow-lg transition-colors duration-300
                          {top ? 'border-indigo-400 bg-indigo-500 text-white shadow-indigo-500/40' : 'border-zinc-800 bg-zinc-900 text-indigo-300'}"
                      >
                        <Icon name={t.icon} size={18} />
                      </span>
                      <span
                        class="absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-full bg-zinc-900 px-2 py-0.5 text-[11px] font-medium text-zinc-300 transition-opacity duration-300
                          {top ? 'opacity-100' : 'opacity-0'}"
                      >
                        {t.label}
                      </span>
                    </span>
                  </span>
                </span>
              {/each}
            </span>
            <span
              in:scale={{ start: 0.5, duration: motion(500), easing: backOut }}
              class="relative grid h-20 w-20 place-items-center rounded-3xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-indigo-500/20"
            >
              <svg viewBox="-180 -180 360 360" class="h-12 w-12">
                <circle r="136" fill="none" stroke="#6366f1" stroke-width="48" class="ob-ring" />
                <path
                  d="M56 -52c-13-17-33-26-56-26-32 0-56 18-56 42 0 24 19 34 53 42 34 7 53 17 53 42 0 25-24 42-56 42-23 0-43-10-56-26"
                  fill="none" stroke="currentColor" stroke-width="34" stroke-linecap="round" class="ob-s text-zinc-200"
                />
              </svg>
            </span>
          </div>
          <div class="space-y-2 text-center">
            <p class="text-lg font-semibold">Hallo{firstName ? ` ${firstName}` : ""}!</p>
            <p class="text-sm text-zinc-400">
              In vier kurzen Schritten stellst du OpenSax so ein, wie du es magst: Design, Navigation, welche Bereiche du
              siehst — und wie du OpenSax mit einem KI-Assistenten verbindest.
            </p>
            <p class="text-xs text-zinc-500">Kennst du dich schon aus? Einfach überspringen — alles geht auch später in den Einstellungen.</p>
          </div>

        {:else if step.id === "theme"}
          <p class="text-sm text-zinc-400">Gilt sofort. Später findest du das im Avatar-Menü.</p>
          <div class="grid gap-2 sm:grid-cols-3 sm:gap-3">
            {#each THEMES as t, i}
              {@const active = theme.pref === t.id}
              <button
                type="button"
                onclick={() => theme.set(t.id)}
                aria-pressed={active}
                in:fly={{ y: 12, delay: motion(60 + i * 60), duration: motion(260), easing: cubicOut }}
                class="group relative flex items-center gap-3 rounded-xl border p-2 text-left transition duration-200 sm:block sm:p-1.5
                  {active ? 'border-indigo-500 ring-2 ring-indigo-500/30' : 'border-zinc-800 hover:-translate-y-0.5 hover:border-zinc-700'}"
              >
                {@render check(active)}
                <span class="relative block aspect-[4/3] w-24 shrink-0 overflow-hidden rounded-lg sm:w-auto">
                  {#if t.id === "system"}
                    {@render themeMock(PALETTE.light)}
                    <span class="absolute inset-0" style="clip-path: polygon(100% 0, 100% 100%, 0 100%)">{@render themeMock(PALETTE.dark)}</span>
                  {:else}
                    {@render themeMock(PALETTE[t.id])}
                  {/if}
                </span>
                <span class="min-w-0 flex-1 pr-6 sm:px-1 sm:pb-0.5 sm:pr-0 sm:pt-2">
                  <span class="flex items-center gap-1.5 text-sm font-medium">
                    <Icon name={t.icon} size={15} class={active ? "text-indigo-300" : "text-zinc-500"} />
                    {t.label}
                  </span>
                  <span class="mt-0.5 block text-xs text-zinc-500 sm:hidden">{t.desc}</span>
                </span>
              </button>
            {/each}
          </div>

        {:else if step.id === "layout"}
          <p class="text-sm text-zinc-400">Gilt für größere Bildschirme. Auf dem Handy ist die Navigation immer unten.</p>
          <div class="grid gap-3 sm:grid-cols-2">
            {#each [{ id: "sidenav", label: "Seitenleiste", desc: "Symbole links am Rand, viel Platz für Inhalte." }, { id: "topnav", label: "Leiste oben", desc: "Bereiche mit Namen oben in einer Zeile." }] as m, i}
              {@const active = nav.mode === m.id}
              <button
                type="button"
                onclick={() => setMode(m.id as NavMode)}
                aria-pressed={active}
                in:fly={{ y: 12, delay: motion(60 + i * 70), duration: motion(260), easing: cubicOut }}
                class="relative rounded-xl border p-2 text-left transition duration-200
                  {active ? 'border-indigo-500 ring-2 ring-indigo-500/30' : 'border-zinc-800 hover:-translate-y-0.5 hover:border-zinc-700'}"
              >
                {@render check(active)}
                <span
                  class="relative flex aspect-[16/9] overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 {m.id === 'sidenav' ? 'flex-row' : 'flex-col'}"
                  aria-hidden="true"
                >
                  {#if m.id === "sidenav"}
                    <span class="relative flex w-7 flex-col items-center gap-1.5 border-r border-zinc-800 bg-zinc-900 py-2">
                      <span class="ob-pill absolute left-1 right-1 top-2 h-3 rounded bg-indigo-500/25 {active ? '' : 'opacity-50'}" style="transform: translate3d(0, {(active ? pillPos : 0) * 18}px, 0)"></span>
                      {#each { length: 4 } as _}<span class="relative h-3 w-3 rounded-sm bg-zinc-700"></span>{/each}
                    </span>
                  {:else}
                    <span class="relative flex h-6 items-center gap-1.5 border-b border-zinc-800 bg-zinc-900 px-2">
                      <span class="ob-pill absolute top-1 bottom-1 left-1.5 w-8 rounded bg-indigo-500/25 {active ? '' : 'opacity-50'}" style="transform: translate3d({(active ? pillPos : 0) * 34}px, 0, 0)"></span>
                      {#each { length: 4 } as _}<span class="relative h-1.5 w-7 rounded-full bg-zinc-700"></span>{/each}
                    </span>
                  {/if}
                  <span class="flex flex-1 flex-col gap-1.5 p-2">
                    <span class="h-1.5 w-1/2 rounded-full bg-zinc-800"></span>
                    <span class="grid flex-1 grid-cols-2 gap-1.5">
                      <span class="rounded bg-zinc-900"></span>
                      <span class="rounded bg-zinc-900"></span>
                    </span>
                  </span>
                </span>
                <span class="block px-1 pt-2 text-sm font-medium">{m.label}</span>
                <span class="block px-1 text-xs text-zinc-500">{m.desc}</span>
              </button>
            {/each}
          </div>

        {:else if step.id === "tabs"}
          <p class="text-sm text-zinc-400">Blende aus, was du nicht nutzt, und sortiere mit den Pfeilen.</p>
          <div class="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
            <p class="mb-2 text-xs text-zinc-500">So sieht die Leiste unten auf dem Handy aus:</p>
            <div class="mx-auto flex max-w-xs justify-around rounded-2xl border border-zinc-800 bg-zinc-950 px-2 py-2">
              {#each bottomPreview as t (t.id)}
                <span animate:flip={{ duration: motion(260) }} in:scale={{ start: 0.5, duration: motion(220) }} class="flex w-12 flex-col items-center gap-0.5 text-zinc-400">
                  <Icon name={t.icon} size={18} />
                  <span class="w-full truncate text-center text-[9px]">{t.label}</span>
                </span>
              {/each}
            </div>
          </div>
          <ul class="divide-y divide-zinc-800 overflow-hidden rounded-xl border border-zinc-800">
            {#each tabRows as t (t.id)}
              {@const on = nav.visible.includes(t.id)}
              {@const idx = nav.visible.indexOf(t.id)}
              <li animate:flip={{ duration: motion(260) }} class="flex items-center gap-3 bg-zinc-950 px-3 py-2 transition-colors {on ? '' : 'bg-zinc-900/40'}">
                <input type="checkbox" class="accent-indigo-500" checked={on} onchange={() => toggleTab(t.id)} aria-label="{t.label} anzeigen" />
                <span class="grid h-7 w-7 place-items-center rounded-lg transition {on ? 'bg-indigo-500/10 text-indigo-300' : 'text-zinc-600'}"><Icon name={t.icon} size={17} /></span>
                <span class="flex-1 text-sm transition {on ? '' : 'text-zinc-500 line-through'}">{t.label}</span>
                {#if on}
                  <button type="button" onclick={() => moveTab(t.id, -1)} disabled={idx === 0} class="rounded p-1 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200 disabled:opacity-30" aria-label="{t.label} nach oben">
                    <Icon name="chevron-left" size={16} class="rotate-90" />
                  </button>
                  <button type="button" onclick={() => moveTab(t.id, 1)} disabled={idx === nav.visible.length - 1} class="rounded p-1 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200 disabled:opacity-30" aria-label="{t.label} nach unten">
                    <Icon name="chevron-right" size={16} class="rotate-90" />
                  </button>
                {/if}
              </li>
            {/each}
          </ul>

        {:else if step.id === "mcp"}
          <div class="relative flex items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-zinc-900/40 px-6 py-5" aria-hidden="true">
            <span in:scale={{ start: 0.5, duration: motion(400), easing: backOut }} class="relative z-10 flex flex-col items-center gap-1.5">
              <span class="grid h-12 w-12 place-items-center rounded-2xl border border-zinc-800 bg-zinc-950 shadow-lg">
                <svg viewBox="-180 -180 360 360" class="h-7 w-7">
                  <circle r="136" fill="none" stroke="#6366f1" stroke-width="48" />
                  <path d="M56 -52c-13-17-33-26-56-26-32 0-56 18-56 42 0 24 19 34 53 42 34 7 53 17 53 42 0 25-24 42-56 42-23 0-43-10-56-26" fill="none" stroke="currentColor" stroke-width="34" stroke-linecap="round" class="text-zinc-200" />
                </svg>
              </span>
              <span class="text-xs text-zinc-400">OpenSax</span>
            </span>
            <span class="relative mx-1 -mt-5 h-8 flex-1">
              <svg class="absolute inset-0 h-full w-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 100 32">
                <line x1="0" y1="16" x2="100" y2="16" stroke="currentColor" stroke-width="2" stroke-dasharray="4 5" vector-effect="non-scaling-stroke" class="ob-dash text-indigo-500/60" />
              </svg>
              {#each ["mail", "calendar", "folder"] as ic, i}
                <span class="ob-travel absolute top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full bg-indigo-500 text-white shadow-md shadow-indigo-500/40" style="animation-delay: {i * 1}s">
                  <Icon name={ic} size={13} />
                </span>
              {/each}
            </span>
            <span in:scale={{ start: 0.5, delay: motion(120), duration: motion(400), easing: backOut }} class="relative z-10 flex flex-col items-center gap-1.5">
              <span class="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-lg shadow-indigo-500/30">
                <Icon name="sparkles" size={24} />
              </span>
              <span class="text-xs text-zinc-400">KI-Assistent</span>
            </span>
          </div>

          <p class="text-sm text-zinc-300">
            Verbunden können <span class="font-medium">Claude</span>, <span class="font-medium">ChatGPT</span> oder
            <span class="font-medium">Mistral Le Chat</span> für dich Mails lesen und schreiben, Aufgaben und Termine nachschlagen,
            Dateien finden oder deinen Stundenplan abfragen. Dafür spricht OpenSax <span class="font-medium">MCP</span>.
          </p>

          <div class="relative grid grid-cols-4 rounded-lg border border-zinc-800 bg-zinc-900 p-1" role="tablist" aria-label="Assistent">
            <span
              class="absolute bottom-1 top-1 rounded-md bg-indigo-500 shadow transition-transform duration-300 ease-out motion-reduce:transition-none"
              style="left: 4px; width: calc((100% - 8px) / 4); transform: translateX({CLIENTS.findIndex((c) => c.id === client) * 100}%)"
            ></span>
            {#each CLIENTS as c}
              <button
                type="button"
                role="tab"
                aria-selected={client === c.id}
                onclick={() => (client = c.id)}
                class="relative z-10 rounded-md py-1.5 text-xs font-medium transition-colors sm:text-sm {client === c.id ? 'text-white' : 'text-zinc-400 hover:text-zinc-200'}"
              >
                {c.label}
              </button>
            {/each}
          </div>

          {#key client}
            <ol class="space-y-4" in:fly={{ y: 8, duration: motion(220), easing: cubicOut }}>
              {#snippet copyUrl()}
                <p>Adresse kopieren:</p>
                {@render copyField(mcpUrl, "MCP-Adresse kopieren")}
              {/snippet}
              {#snippet confirm()}
                <p>Beim Verbinden schickt dich der Assistent einmal hierher, um den Zugriff zu bestätigen — fertig.</p>
              {/snippet}
              {#if client === "claude"}
                {#snippet add()}
                  <p>
                    In Claude unter <span class="font-medium">Einstellungen → Connectors</span> auf
                    <span class="font-medium">„Custom Connector hinzufügen“</span> und die Adresse einfügen.
                  </p>
                  {@render external("https://claude.ai/settings/connectors", "claude.ai")}
                {/snippet}
                {@render instruction(1, everCopied, copyUrl)}
                {@render instruction(2, false, add)}
                {@render instruction(3, false, confirm)}
              {:else if client === "chatgpt"}
                {#snippet add()}
                  <p>
                    In ChatGPT unter <span class="font-medium">Einstellungen → Apps &amp; Connectors → Erweitert</span> den
                    <span class="font-medium">Entwicklermodus</span> einschalten, dann <span class="font-medium">„Erstellen“</span>,
                    die Adresse einfügen und als Authentifizierung <span class="font-medium">OAuth</span> wählen.
                  </p>
                  {@render external("https://chatgpt.com/#settings/Connectors", "chatgpt.com")}
                {/snippet}
                {@render instruction(1, everCopied, copyUrl)}
                {@render instruction(2, false, add)}
                {@render instruction(3, false, confirm)}
              {:else if client === "lechat"}
                {#snippet add()}
                  <p>
                    In Le Chat unter <span class="font-medium">Intelligence → Connectors</span> auf
                    <span class="font-medium">„Connector hinzufügen“ → „Custom MCP Connector“</span>, die Adresse einfügen und
                    OAuth als Anmeldung wählen.
                  </p>
                  {@render external("https://chat.mistral.ai/connections", "chat.mistral.ai")}
                {/snippet}
                {@render instruction(1, everCopied, copyUrl)}
                {@render instruction(2, false, add)}
                {@render instruction(3, false, confirm)}
              {:else}
                {#snippet o1()}
                  <p>Jeder Assistent, der MCP über <span class="font-medium">HTTP</span> (Streamable HTTP) mit OAuth kann, nimmt diese Adresse:</p>
                  {@render copyField(mcpUrl, "MCP-Adresse kopieren")}
                {/snippet}
                {#snippet o2()}
                  <p>Für <span class="font-medium">Claude Code</span> im Terminal:</p>
                  {@render copyField(cliCommand, "Befehl kopieren")}
                {/snippet}
                {@render instruction(1, everCopied, o1)}
                {@render instruction(2, false, o2)}
                {@render instruction(3, false, confirm)}
              {/if}
            </ol>
          {/key}

          <p class="flex items-start gap-2 rounded-lg bg-zinc-900/60 px-3 py-2 text-xs text-zinc-500">
            <Icon name="info-circle" size={15} class="mt-px shrink-0" />
            Der Assistent bekommt erst Zugriff, wenn du ihn bestätigst. Verbindungen siehst und trennst du jederzeit unter Einstellungen → Verbindungen.
          </p>

        {:else if step.id === "done"}
          <div class="relative mx-auto mt-4 grid h-16 w-16 place-items-center" aria-hidden="true">
            <span class="ob-burst absolute inset-0 rounded-full border-2 border-emerald-400/60"></span>
            {#each { length: 10 } as _, i}
              {@const a = (i / 10) * Math.PI * 2}
              <span
                class="ob-confetti absolute left-1/2 top-1/2 -ml-[3px] -mt-[3px] h-1.5 w-1.5 rounded-full {['bg-indigo-400', 'bg-emerald-400', 'bg-violet-400', 'bg-amber-400'][i % 4]}"
                style="--tx: {Math.cos(a) * 64}px; --ty: {Math.sin(a) * 52}px; animation-delay: {120 + i * 15}ms"
              ></span>
            {/each}
            <span
              in:scale={{ start: 0.2, duration: motion(500), easing: backOut }}
              class="relative grid h-16 w-16 place-items-center rounded-full bg-emerald-500 text-white shadow-xl shadow-emerald-500/30"
            >
              <svg viewBox="0 0 24 24" class="h-8 w-8" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 12l5 5l10 -10" class="ob-tick" />
              </svg>
            </span>
          </div>
          <div class="flex flex-wrap justify-center gap-2 pt-2">
            {#each [
              { icon: theme.pref === "light" ? "sun" : theme.pref === "dark" ? "moon" : "device-desktop", text: themeLabel },
              { icon: "menu", text: nav.mode === "sidenav" ? "Seitenleiste" : "Leiste oben" },
              { icon: "list-check", text: `${nav.visible.length} Bereiche` },
            ] as chip, i}
              <span
                in:fly={{ y: 10, delay: motion(250 + i * 80), duration: motion(280), easing: cubicOut }}
                class="flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs text-zinc-300"
              >
                <Icon name={chip.icon} size={14} class="text-indigo-300" /> {chip.text}
              </span>
            {/each}
          </div>
          <div class="rounded-xl border border-zinc-800 px-3 py-2.5 text-sm text-zinc-400">
            <p class="font-medium text-zinc-300">Alles davon kannst du jederzeit ändern:</p>
            <ul class="mt-1 space-y-0.5 text-xs">
              <li>· Design im Avatar-Menü</li>
              <li>· Navigation und Bereiche unter Einstellungen → Navigation</li>
              <li>· KI-Verbindungen unter Einstellungen → Verbindungen</li>
            </ul>
          </div>
        {/if}
      </div>
    {/key}
  </WizardFrame>
{/if}

<style>
  /* Der Blur würde sonst in jedem Frame neu gezeichnet. */
  .ob-glow { animation: ob-glow 3.5s ease-in-out infinite; will-change: transform, opacity; }
  @keyframes ob-glow {
    0%, 100% { opacity: 0.6; transform: scale3d(0.92, 0.92, 1); }
    50% { opacity: 1; transform: scale3d(1.08, 1.08, 1); }
  }
  .ob-ring { stroke-dasharray: 855; stroke-dashoffset: 855; animation: ob-draw 900ms 150ms ease-out forwards; }
  .ob-s { stroke-dasharray: 500; stroke-dashoffset: 500; animation: ob-draw 700ms 700ms ease-out forwards; }
  .ob-tick { stroke-dasharray: 24; stroke-dashoffset: 24; animation: ob-draw 400ms 300ms ease-out forwards; }
  @keyframes ob-draw { to { stroke-dashoffset: 0; } }

  .ob-pill { transition: transform 600ms cubic-bezier(0.65, 0, 0.35, 1), opacity 300ms; }

  .ob-dash { animation: ob-dash 1s linear infinite; }
  @keyframes ob-dash { to { stroke-dashoffset: -9; } }
  .ob-travel { left: 0; opacity: 0; animation: ob-travel 3s ease-in-out infinite; }
  @keyframes ob-travel {
    0% { left: 0; opacity: 0; transform: translate(-50%, -50%) scale(0.6); }
    15% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
    85% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
    100% { left: 100%; opacity: 0; transform: translate(-50%, -50%) scale(0.6); }
  }

  .ob-burst { animation: ob-burst 900ms 200ms ease-out forwards; opacity: 0; }
  @keyframes ob-burst {
    0% { opacity: 0.9; transform: scale(0.8); }
    100% { opacity: 0; transform: scale(2.2); }
  }
  .ob-confetti { opacity: 0; animation: ob-confetti 900ms ease-out forwards; }
  @keyframes ob-confetti {
    0% { opacity: 1; transform: translate(0, 0) scale(1); }
    100% { opacity: 0; transform: translate(var(--tx), var(--ty)) scale(0.4); }
  }

  @media (prefers-reduced-motion: reduce) {
    .ob-glow, .ob-dash { animation: none; }
    .ob-pill { transition: none; }
    .ob-ring, .ob-s, .ob-tick { animation: none; stroke-dashoffset: 0; }
    .ob-travel { animation: none; left: 50%; opacity: 1; transform: translate(-50%, -50%); }
    .ob-travel + .ob-travel { display: none; }
    .ob-burst, .ob-confetti { animation: none; display: none; }
  }
</style>
