<script lang="ts">
  import { enhance } from "$app/forms";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import Icon from "$lib/Icon.svelte";
  import ConnectionsList from "$lib/ConnectionsList.svelte";
  import ConnectionsMcpUrl from "$lib/ConnectionsMcpUrl.svelte";
  import { NAV_TABS, loadNavConfig, saveNavConfig, tabById, type NavConfig, type NavMode } from "$lib/nav";

  let { data, form } = $props();
  const p = $derived(data.profile);

  type Tab = "profile" | "mail" | "connections" | "navigation" | "account";
  const TABS: ReadonlySet<Tab> = new Set(["profile", "mail", "connections", "navigation", "account"]);
  const tab = $derived.by<Tab>(() => {
    const t = page.url.searchParams.get("tab");
    return TABS.has(t as Tab) ? (t as Tab) : "profile";
  });
  function setTab(t: Tab) {
    const u = new URL(page.url);
    if (t === "profile") u.searchParams.delete("tab");
    else u.searchParams.set("tab", t);
    goto(u.pathname + u.search, { keepFocus: true, noScroll: true, replaceState: false });
  }

  // Nav configuration (client-only)
  let navConfig = $state<NavConfig>({
    visible: NAV_TABS.filter((t) => t.id !== "home").map((t) => t.id),
    hidden: [],
    mode: "sidenav",
  });
  let navMounted = $state(false);
  $effect(() => {
    if (navMounted) return;
    navConfig = loadNavConfig();
    navMounted = true;
  });

  function persist() {
    saveNavConfig(navConfig);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("lernsax:nav-changed"));
    }
  }
  function setMode(m: NavMode) {
    if (navConfig.mode === m) return;
    navConfig = { ...navConfig, mode: m };
    persist();
  }
  function show(id: string) {
    navConfig = {
      ...navConfig,
      visible: [...navConfig.visible, id],
      hidden: navConfig.hidden.filter((x) => x !== id),
    };
    persist();
  }
  function resetNav() {
    navConfig = {
      visible: NAV_TABS.filter((t) => t.id !== "home").map((t) => t.id),
      hidden: [],
      mode: navConfig.mode,
    };
    persist();
  }

  // ── Live drag & drop ────────────────────────────────────────────────
  // Items shift in place during dragenter — final layout is the live preview.
  // Dragging into the "ausgeblendet" section toggles visibility and back.
  type Section = "visible" | "hidden";
  let dragId = $state<string | null>(null);

  function onDragStart(e: DragEvent, id: string) {
    dragId = id;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
    }
  }
  function locate(id: string): { section: Section; index: number } | null {
    let i = navConfig.visible.indexOf(id);
    if (i >= 0) return { section: "visible", index: i };
    i = navConfig.hidden.indexOf(id);
    if (i >= 0) return { section: "hidden", index: i };
    return null;
  }
  function moveLive(id: string, target: { section: Section; index: number }) {
    const cur = locate(id);
    if (!cur) return;
    if (cur.section === target.section && cur.index === target.index) return;
    const v = [...navConfig.visible];
    const h = [...navConfig.hidden];
    if (cur.section === "visible") v.splice(cur.index, 1);
    else h.splice(cur.index, 1);

    let insertAt = target.index;
    if (cur.section === target.section && cur.index < target.index) insertAt -= 1;
    if (target.section === "visible") {
      v.splice(Math.max(0, Math.min(insertAt, v.length)), 0, id);
    } else {
      h.splice(Math.max(0, Math.min(insertAt, h.length)), 0, id);
    }
    navConfig = { ...navConfig, visible: v, hidden: h };
  }
  function onItemDragEnter(e: DragEvent, section: Section, index: number) {
    if (!dragId) return;
    e.preventDefault();
    moveLive(dragId, { section, index });
  }
  function onSectionDragOver(e: DragEvent) {
    if (!dragId) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  }
  function onSectionDragEnter(e: DragEvent, section: Section) {
    if (!dragId) return;
    e.preventDefault();
    const cur = locate(dragId);
    if (!cur || cur.section === section) return;
    const len = section === "visible" ? navConfig.visible.length : navConfig.hidden.length;
    moveLive(dragId, { section, index: len });
  }
  function onDragEnd() {
    dragId = null;
    persist();
  }
</script>

<div class="grid h-full" style="grid-template-columns: 240px 1fr">
  <!-- Tab rail -->
  <aside class="flex h-full flex-col border-r border-zinc-800 bg-zinc-900/30 p-3">
    <h1 class="mb-3 px-2 text-base font-semibold tracking-tight">Einstellungen</h1>
    {#each [["profile", "Profil", "settings"], ["mail", "Mail", "mail"], ["connections", "Verbindungen", "send"], ["navigation", "Navigation", "list-check"], ["account", "Account", "logout"]] as [k, label, icon]}
      <button
        class="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition
          {tab === k ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'}"
        onclick={() => setTab(k as Tab)}
      >
        <Icon name={icon} size={16} />
        {label}
      </button>
    {/each}
  </aside>

  <!-- Tab body -->
  <section class="overflow-auto">
    <div class="mx-auto max-w-2xl px-8 py-8">
      {#if tab === "profile"}
        <h2 class="mb-4 text-xl font-semibold tracking-tight">Profil</h2>
        <form method="POST" action="?/saveProfile" use:enhance class="space-y-5 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
          <fieldset>
            <legend class="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Name</legend>
            <div class="grid grid-cols-2 gap-3">
              <label class="block">
                <span class="mb-1 block text-xs text-zinc-400">Vorname</span>
                <input name="firstname" value={p.firstname ?? ""} class="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
              </label>
              <label class="block">
                <span class="mb-1 block text-xs text-zinc-400">Nachname</span>
                <input name="lastname" value={p.lastname ?? ""} class="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
              </label>
              <label class="block col-span-2">
                <span class="mb-1 block text-xs text-zinc-400">Titel</span>
                <input name="title" value={p.title ?? ""} placeholder="Dr., Prof. …" class="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend class="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Kontakt</legend>
            <div class="grid grid-cols-2 gap-3">
              <label class="block">
                <span class="mb-1 block text-xs text-zinc-400">Telefon</span>
                <input name="phone" value={p.phone ?? ""} class="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
              </label>
              <label class="block">
                <span class="mb-1 block text-xs text-zinc-400">Mobil</span>
                <input name="phone_mobile" value={p.phone_mobile ?? ""} class="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
              </label>
              <label class="block">
                <span class="mb-1 block text-xs text-zinc-400">Geschäftlich</span>
                <input name="phone_business" value={p.phone_business ?? ""} class="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
              </label>
              <label class="block">
                <span class="mb-1 block text-xs text-zinc-400">Fax</span>
                <input name="fax" value={p.fax ?? ""} class="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend class="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Adresse</legend>
            <div class="grid grid-cols-3 gap-3">
              <label class="block col-span-3">
                <span class="mb-1 block text-xs text-zinc-400">Straße</span>
                <input name="street" value={p.street ?? ""} class="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
              </label>
              <label class="block">
                <span class="mb-1 block text-xs text-zinc-400">PLZ</span>
                <input name="zip" value={p.zip ?? ""} class="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
              </label>
              <label class="block col-span-2">
                <span class="mb-1 block text-xs text-zinc-400">Ort</span>
                <input name="city" value={p.city ?? ""} class="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
              </label>
              <label class="block col-span-3">
                <span class="mb-1 block text-xs text-zinc-400">Land</span>
                <input name="country" value={p.country ?? ""} class="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend class="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Arbeit</legend>
            <div class="grid grid-cols-2 gap-3">
              <label class="block">
                <span class="mb-1 block text-xs text-zinc-400">Firma / Schule</span>
                <input name="company" value={p.company ?? ""} class="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
              </label>
              <label class="block">
                <span class="mb-1 block text-xs text-zinc-400">Position</span>
                <input name="position" value={p.position ?? ""} class="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
              </label>
              <label class="block">
                <span class="mb-1 block text-xs text-zinc-400">Abteilung</span>
                <input name="department" value={p.department ?? ""} class="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
              </label>
              <label class="block">
                <span class="mb-1 block text-xs text-zinc-400">Homepage</span>
                <input name="homepage" type="url" value={p.homepage ?? ""} class="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend class="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Persönlich</legend>
            <div class="grid grid-cols-2 gap-3">
              <label class="block">
                <span class="mb-1 block text-xs text-zinc-400">Geburtstag (TT.MM.JJJJ)</span>
                <input name="birthday" value={p.birthday ?? ""} placeholder="01.01.2000" class="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
              </label>
              <label class="block">
                <span class="mb-1 block text-xs text-zinc-400">Skype</span>
                <input name="skype" value={p.skype ?? ""} class="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
              </label>
              <label class="block col-span-2">
                <span class="mb-1 block text-xs text-zinc-400">Notiz</span>
                <textarea name="comment" rows="3" class="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500">{p.comment ?? ""}</textarea>
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend class="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Sichtbarkeit</legend>
            <label class="block">
              <span class="mb-1 block text-xs text-zinc-400">Wer sieht mein Profil?</span>
              <select name="visible" class="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500">
                <option value="0" selected={p.visible === "0"}>Nur eigene Gruppen</option>
                <option value="1" selected={p.visible === "1"}>Schule</option>
                <option value="2" selected={p.visible === "2"}>Alle</option>
              </select>
            </label>
            <div class="mt-3 grid grid-cols-2 gap-3 text-sm">
              <label class="flex items-center gap-2"><input type="checkbox" name="show_phone" value="1" checked={p.show_phone === "1"} /> Telefon zeigen</label>
              <label class="flex items-center gap-2"><input type="checkbox" name="show_email" value="1" checked={p.show_email === "1"} /> E-Mail zeigen</label>
              <label class="flex items-center gap-2"><input type="checkbox" name="show_address" value="1" checked={p.show_address === "1"} /> Adresse zeigen</label>
              <label class="flex items-center gap-2"><input type="checkbox" name="show_company" value="1" checked={p.show_company === "1"} /> Firma zeigen</label>
            </div>
          </fieldset>

          {#if form?.ok && form?.scope === "profile"}<p class="text-xs text-emerald-400">Gespeichert.</p>{/if}
          {#if form?.error}<p class="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-400">{form.error}</p>{/if}

          <div class="flex justify-end pt-2">
            <button class="rounded-md bg-indigo-500 px-4 py-1.5 text-sm font-medium hover:bg-indigo-400">Speichern</button>
          </div>
        </form>
      {:else if tab === "mail"}
        <h2 class="mb-4 text-xl font-semibold tracking-tight">Mail</h2>
        <form method="POST" action="?/saveSignature" use:enhance class="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
          <h3 class="text-sm font-semibold uppercase tracking-wide text-zinc-400">Signatur</h3>
          <p class="text-xs text-zinc-500">Wird automatisch beim Antworten und Weiterleiten angefügt.</p>
          <textarea name="text" rows="8" class="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-sm leading-relaxed outline-none focus:border-indigo-500" placeholder="-- &#10;Vorname Nachname&#10;…">{data.signature.text}</textarea>
          <div class="grid grid-cols-2 gap-3">
            <label class="block">
              <span class="mb-1 block text-xs text-zinc-400">Position bei Antworten</span>
              <select name="position_answer" class="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500">
                <option value="end" selected={data.signature.position_answer === "end"}>Am Ende</option>
                <option value="start" selected={data.signature.position_answer === "start"}>Am Anfang</option>
              </select>
            </label>
            <label class="block">
              <span class="mb-1 block text-xs text-zinc-400">Position bei Weiterleiten</span>
              <select name="position_forward" class="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500">
                <option value="end" selected={data.signature.position_forward === "end"}>Am Ende</option>
                <option value="start" selected={data.signature.position_forward === "start"}>Am Anfang</option>
              </select>
            </label>
          </div>
          {#if form?.ok && form?.scope === "signature"}<p class="text-xs text-emerald-400">Gespeichert.</p>{/if}
          <div class="flex justify-end pt-1">
            <button class="rounded-md bg-indigo-500 px-4 py-1.5 text-sm font-medium hover:bg-indigo-400">Speichern</button>
          </div>
        </form>

        <div class="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 text-sm text-zinc-400">
          <h3 class="mb-1 text-sm font-semibold text-zinc-300">Filterregeln</h3>
          <p>Diese API ist auf dem LernSax-Server nicht öffentlich erreichbar. Sobald sie verfügbar ist, kommt das Modul automatisch hier rein.</p>
        </div>
      {:else if tab === "connections"}
        {@const fmtRel = (ts: number) => {
          const d = Math.floor((Date.now() - ts) / 1000);
          if (d < 60) return "gerade eben";
          if (d < 3600) return `vor ${Math.floor(d / 60)}m`;
          if (d < 86400) return `vor ${Math.floor(d / 3600)}h`;
          return new Date(ts).toLocaleDateString("de-DE", { dateStyle: "medium" });
        }}
        <h2 class="mb-1 text-xl font-semibold tracking-tight">Verbindungen</h2>
        <p class="mb-4 text-sm text-zinc-400">
          AI-Tools und andere Clients, die du via MCP autorisiert hast. Du kannst jeden Zugriff hier widerrufen.
        </p>

        <section class="mb-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
          <h3 class="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">MCP-Endpoint</h3>
          <p class="mb-3 text-xs text-zinc-500">
            Trage diese URL in einem Custom-MCP-Connector (z.B. Claude.ai → Einstellungen → Connectors) ein.
            Beim ersten Aufruf wirst du hierhin geleitet, um den Zugriff zu bestätigen.
          </p>
          <ConnectionsMcpUrl />
        </section>

        <ConnectionsList />
      {:else if tab === "navigation"}
        <h2 class="mb-4 text-xl font-semibold tracking-tight">Navigation</h2>

        <section class="mb-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
          <h3 class="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Layout</h3>
          <div class="grid grid-cols-2 gap-3">
            <button
              onclick={() => setMode("sidenav")}
              class="group flex flex-col items-stretch overflow-hidden rounded-xl border-2 transition
                {navConfig.mode === 'sidenav' ? 'border-indigo-500 bg-indigo-500/5' : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700'}"
            >
              <div class="flex h-20 gap-1 p-2">
                <div class="w-3 rounded bg-zinc-700"></div>
                <div class="flex-1 rounded bg-zinc-800/50"></div>
              </div>
              <div class="border-t border-zinc-800 px-3 py-1.5 text-left text-xs">
                <p class="font-medium text-zinc-200">Seitenleiste</p>
                <p class="text-zinc-500">Schmale Leiste links</p>
              </div>
            </button>
            <button
              onclick={() => setMode("topnav")}
              class="group flex flex-col items-stretch overflow-hidden rounded-xl border-2 transition
                {navConfig.mode === 'topnav' ? 'border-indigo-500 bg-indigo-500/5' : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700'}"
            >
              <div class="flex h-20 flex-col gap-1 p-2">
                <div class="h-3 rounded bg-zinc-700"></div>
                <div class="flex-1 rounded bg-zinc-800/50"></div>
              </div>
              <div class="border-t border-zinc-800 px-3 py-1.5 text-left text-xs">
                <p class="font-medium text-zinc-200">Top-Leiste</p>
                <p class="text-zinc-500">Horizontale Leiste oben</p>
              </div>
            </button>
          </div>
        </section>

        <section class="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div class="mb-3 flex items-center justify-between">
            <h3 class="text-xs font-semibold uppercase tracking-wide text-zinc-500">Tabs</h3>
            <p class="text-xs text-zinc-500">Drag &amp; Drop zum Verschieben</p>
          </div>

          <p class="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-600">Sichtbar</p>
          <ul
            class="mb-4 min-h-12 space-y-1 rounded-lg border border-dashed border-zinc-800 p-1.5"
            ondragover={onSectionDragOver}
            ondragenter={(e) => onSectionDragEnter(e, "visible")}
            role="list"
          >
            {#each navConfig.visible as id, i (id)}
              {@const t = tabById(id)}
              {#if t}
                <li
                  draggable="true"
                  ondragstart={(e) => onDragStart(e, id)}
                  ondragenter={(e) => onItemDragEnter(e, "visible", i)}
                  ondragover={onSectionDragOver}
                  ondragend={onDragEnd}
                  class="flex items-center gap-2 rounded-md border bg-zinc-950 px-2 py-1.5 transition
                    {dragId === id ? 'opacity-30' : 'border-zinc-800 hover:border-zinc-700'}"
                >
                  <span class="cursor-grab text-zinc-600 active:cursor-grabbing" title="Ziehen">
                    <Icon name="dots-vertical" size={14} />
                  </span>
                  <Icon name={t.icon} size={16} class="text-zinc-400" />
                  <span class="flex-1 text-sm">{t.label}</span>
                </li>
              {/if}
            {:else}
              <li class="px-2 py-3 text-center text-xs text-zinc-500">Hier ablegen, um wieder einzublenden</li>
            {/each}
          </ul>

          <p class="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-600">Ausgeblendet</p>
          <ul
            class="min-h-12 space-y-1 rounded-lg border border-dashed border-zinc-800 p-1.5"
            ondragover={onSectionDragOver}
            ondragenter={(e) => onSectionDragEnter(e, "hidden")}
            role="list"
          >
            {#each navConfig.hidden as id, i (id)}
              {@const t = tabById(id)}
              {#if t}
                <li
                  draggable="true"
                  ondragstart={(e) => onDragStart(e, id)}
                  ondragenter={(e) => onItemDragEnter(e, "hidden", i)}
                  ondragover={onSectionDragOver}
                  ondragend={onDragEnd}
                  class="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-zinc-500
                    {dragId === id ? 'opacity-30' : 'hover:border-zinc-700'}"
                >
                  <span class="cursor-grab text-zinc-600 active:cursor-grabbing" title="Ziehen">
                    <Icon name="dots-vertical" size={14} />
                  </span>
                  <Icon name={t.icon} size={16} />
                  <span class="flex-1 text-sm">{t.label}</span>
                  <button onclick={() => show(id)} class="rounded p-1 hover:bg-zinc-800 hover:text-zinc-200" aria-label="Einblenden" title="Einblenden">
                    <Icon name="plus" size={14} />
                  </button>
                </li>
              {/if}
            {:else}
              <li class="px-2 py-3 text-center text-xs text-zinc-500">Hier ablegen, um auszublenden</li>
            {/each}
          </ul>

          <div class="mt-4 flex justify-end">
            <button onclick={resetNav} class="text-xs text-zinc-500 hover:text-zinc-300">Auf Standard zurücksetzen</button>
          </div>
        </section>
      {:else}
        <h2 class="mb-4 text-xl font-semibold tracking-tight">Account</h2>
        <section class="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
          <dl class="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
            <dt class="text-zinc-500">Login</dt><dd>{data.user?.login ?? "—"}</dd>
            <dt class="text-zinc-500">Voller Name</dt><dd>{data.user?.fullname ?? "—"}</dd>
            <dt class="text-zinc-500">Schule</dt><dd>{data.user?.base_user?.name_hr ?? "—"}</dd>
            <dt class="text-zinc-500">Gruppen</dt>
            <dd>
              <ul class="space-y-0.5 text-zinc-300">
                {#each data.groups as g}
                  <li>{g.name_hr ?? g.login} <span class="text-xs text-zinc-500">&lt;{g.login}&gt;</span></li>
                {/each}
              </ul>
            </dd>
          </dl>
        </section>
        <section class="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
          <h3 class="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">Sitzung</h3>
          <p class="mb-3 text-sm text-zinc-400">Beendet die Session und löscht den Cookie.</p>
          <button
            onclick={async () => { await fetch("/api/logout", { method: "POST" }); window.location.href = "/login"; }}
            class="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-1.5 text-sm font-medium text-red-300 hover:bg-red-500/20"
          >Abmelden</button>
        </section>
      {/if}
    </div>
  </section>
</div>
