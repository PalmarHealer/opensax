<script lang="ts">
  import { goto } from "$app/navigation";
  import Icon from "$lib/Icon.svelte";
  import WizardFrame from "$lib/WizardFrame.svelte";
  import ConnectionsMcpUrl from "$lib/ConnectionsMcpUrl.svelte";
  import { NAV_TABS, loadNavConfig, saveNavConfig, tabById, type NavConfig, type NavMode } from "$lib/nav";
  import { theme } from "$lib/themeStore.svelte";

  /**
   * Einrichtung nach dem ersten Login: Design, Navigations-Layout, welche
   * Tabs, Hinweis auf MCP. Jede Wahl gilt sofort (dieselben Speicherorte wie
   * in den Einstellungen), „Überspringen“ ist auf jedem Schritt möglich. Ob
   * es durchlaufen wurde, merkt sich der Server pro Account (/api/onboarding),
   * damit es auf dem nächsten Gerät nicht wieder erscheint.
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
  const step = $derived(STEPS[stepIndex]!);

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
    applyNav({ ...nav, mode });
  }
  function toggleTab(id: string) {
    if (nav.visible.includes(id)) {
      applyNav({ ...nav, visible: nav.visible.filter((v) => v !== id), hidden: [...nav.hidden, id] });
    } else {
      applyNav({ ...nav, hidden: nav.hidden.filter((v) => v !== id), visible: [...nav.visible, id] });
    }
  }
  function moveTab(id: string, dir: -1 | 1) {
    const list = [...nav.visible];
    const i = list.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    applyNav({ ...nav, visible: list });
  }
  /** Visible tabs in their order, then the hidden ones. */
  const tabRows = $derived([
    ...nav.visible.map((id) => tabById(id)).filter((t) => !!t),
    ...NAV_TABS.filter((t) => t.id !== "home" && !nav.visible.includes(t.id)),
  ]);

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

  async function connectNow() {
    await finish("completed");
    goto("/settings?tab=connections");
  }

  const firstName = $derived(displayName.split(/\s+/)[0] ?? "");
  const themeLabel = $derived({ light: "Hell", dark: "Dunkel", system: "wie dein Gerät" }[theme.pref]);
</script>

{#snippet card(active: boolean, onclick: () => void, icon: string, label: string, desc: string)}
  <button
    type="button"
    {onclick}
    aria-pressed={active}
    class="flex items-start gap-3 rounded-xl border p-3 text-left transition
      {active ? 'border-indigo-500 bg-indigo-500/10' : 'border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900'}"
  >
    <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-zinc-900 text-indigo-300"><Icon name={icon} size={20} /></span>
    <span>
      <span class="block text-sm font-medium">{label}</span>
      <span class="block text-xs text-zinc-500">{desc}</span>
    </span>
  </button>
{/snippet}

{#snippet nav_()}
  {#if step.id !== "done"}
    <button type="button" onclick={() => finish("skipped")} class="rounded-md px-2 py-1.5 text-sm text-zinc-500 hover:text-zinc-200">Überspringen</button>
  {:else}
    <span></span>
  {/if}
  <div class="flex items-center gap-2">
    {#if stepIndex > 0 && step.id !== "done"}
      <button type="button" onclick={() => (stepIndex -= 1)} class="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-zinc-400 hover:text-zinc-100">
        <Icon name="chevron-left" size={16} /> Zurück
      </button>
    {/if}
    {#if step.id === "done"}
      <button type="button" onclick={() => finish("completed")} class="rounded-md bg-indigo-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-400">Los geht's</button>
    {:else}
      <button type="button" onclick={() => (stepIndex += 1)} class="flex items-center gap-1 rounded-md bg-indigo-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-400">
        {step.id === "welcome" ? "Einrichten" : "Weiter"} <Icon name="chevron-right" size={16} />
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
    footer={nav_}
  >
    {#if step.id === "welcome"}
      <p class="text-sm text-zinc-300">
        Hallo{firstName ? ` ${firstName}` : ""}! In vier kurzen Schritten stellst du OpenSax so ein, wie du es magst:
        Design, Navigation, welche Bereiche du siehst — und wie du OpenSax mit einem KI-Assistenten verbindest.
      </p>
      <p class="text-sm text-zinc-500">Kennst du dich schon aus? Dann einfach überspringen — alles geht auch später in den Einstellungen.</p>

    {:else if step.id === "theme"}
      <p class="text-sm text-zinc-400">Gilt sofort. Später findest du das im Avatar-Menü.</p>
      <div class="grid gap-2">
        {@render card(theme.pref === "light", () => theme.set("light"), "sun", "Hell", "Heller Hintergrund, dunkle Schrift.")}
        {@render card(theme.pref === "dark", () => theme.set("dark"), "moon", "Dunkel", "Schont die Augen am Abend.")}
        {@render card(theme.pref === "system", () => theme.set("system"), "device-desktop", "Wie mein Gerät", "Wechselt mit der Einstellung deines Systems.")}
      </div>

    {:else if step.id === "layout"}
      <p class="text-sm text-zinc-400">Gilt für größere Bildschirme. Auf dem Handy ist die Navigation immer unten.</p>
      <div class="grid gap-2 sm:grid-cols-2">
        {@render card(nav.mode === "sidenav", () => setMode("sidenav"), "menu", "Seitenleiste", "Symbole links am Rand, viel Platz für Inhalte.")}
        {@render card(nav.mode === "topnav", () => setMode("topnav"), "dots", "Leiste oben", "Bereiche mit Namen oben in einer Zeile.")}
      </div>

    {:else if step.id === "tabs"}
      <p class="text-sm text-zinc-400">
        Blende aus, was du nicht nutzt, und sortiere mit den Pfeilen. Die ersten Bereiche erscheinen auf dem Handy in der Leiste unten.
      </p>
      <ul class="overflow-hidden rounded-lg border border-zinc-800">
        {#each tabRows as t (t!.id)}
          {@const on = nav.visible.includes(t!.id)}
          {@const idx = nav.visible.indexOf(t!.id)}
          <li class="flex items-center gap-3 border-t border-zinc-800 px-3 py-2 first:border-t-0">
            <input type="checkbox" class="accent-indigo-500" checked={on} onchange={() => toggleTab(t!.id)} aria-label="{t!.label} anzeigen" />
            <span class="text-zinc-400 {on ? '' : 'opacity-40'}"><Icon name={t!.icon} size={18} /></span>
            <span class="flex-1 text-sm {on ? '' : 'text-zinc-500 line-through'}">{t!.label}</span>
            {#if on}
              <button type="button" onclick={() => moveTab(t!.id, -1)} disabled={idx === 0} class="rounded p-1 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200 disabled:opacity-30" aria-label="{t!.label} nach oben">
                <Icon name="chevron-left" size={16} class="rotate-90" />
              </button>
              <button type="button" onclick={() => moveTab(t!.id, 1)} disabled={idx === nav.visible.length - 1} class="rounded p-1 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200 disabled:opacity-30" aria-label="{t!.label} nach unten">
                <Icon name="chevron-right" size={16} class="rotate-90" />
              </button>
            {/if}
          </li>
        {/each}
      </ul>

    {:else if step.id === "mcp"}
      <p class="text-sm text-zinc-300">
        OpenSax spricht <span class="font-medium">MCP</span>, das Protokoll, mit dem sich KI-Assistenten wie Claude an andere Dienste anschließen.
        Verbunden kann der Assistent für dich Mails lesen und schreiben, Aufgaben und Termine nachschlagen, Dateien finden oder deinen Stundenplan abfragen.
      </p>
      <div class="space-y-1.5">
        <p class="text-xs text-zinc-500">Diese Adresse trägst du im Assistenten als Connector ein:</p>
        <ConnectionsMcpUrl />
      </div>
      <p class="text-xs text-zinc-500">
        Der Assistent bekommt nur Zugriff, wenn du ihn einmal bestätigst. Verbindungen siehst und trennst du unter Einstellungen → Verbindungen.
      </p>
      <button type="button" onclick={connectNow} class="flex items-center gap-1.5 text-sm text-indigo-300 hover:text-indigo-200">
        Jetzt verbinden <Icon name="chevron-right" size={14} />
      </button>

    {:else if step.id === "done"}
      <div class="space-y-3 py-2 text-center">
        <div class="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-500/15 text-emerald-400">
          <Icon name="check" size={26} />
        </div>
        <p class="text-sm text-zinc-300">
          Design: {themeLabel} · {nav.mode === "sidenav" ? "Seitenleiste" : "Leiste oben"} · {nav.visible.length} Bereiche
        </p>
      </div>
      <div class="rounded-lg border border-zinc-800 px-3 py-2.5 text-sm text-zinc-400">
        <p class="font-medium text-zinc-300">Alles davon kannst du jederzeit ändern:</p>
        <ul class="mt-1 space-y-0.5 text-xs">
          <li>· Design im Avatar-Menü</li>
          <li>· Navigation und Bereiche unter Einstellungen → Navigation</li>
          <li>· KI-Verbindungen unter Einstellungen → Verbindungen</li>
        </ul>
      </div>
    {/if}
  </WizardFrame>
{/if}
