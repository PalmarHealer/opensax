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

  interface StorageInfo {
    session: { present: boolean; ttl_days: number; cookie: { name: string; http_only: boolean; secure: boolean; same_site: string }; stored: string[] };
    account: {
      user_id: string | null;
      devices: {
        count: number;
        records: Array<{
          device_id: string;
          current: boolean;
          createdAt: number;
          lastSeen: number;
          firstIp: string | null;
          lastIp: string | null;
          userAgent: string | null;
        }>;
      };
    };
    connections: { count: number; ttl_days: number | null; stored: string[]; scope?: string; records: Array<{ id: string; client_name: string; scopes: string[]; created_at: number; last_used_at: number }> };
    cache: Record<string, { ttl_seconds?: number; ttl_minutes?: string | number; scope: string; stored: string[] }>;
    not_stored: string[];
  }
  let storage = $state<StorageInfo | null>(null);
  let storageLoading = $state(false);
  let confirming = $state(false);
  async function loadStorage() {
    if (storage || storageLoading) return;
    storageLoading = true;
    try {
      const r = await fetch("/api/account/storage");
      if (r.ok) storage = await r.json();
    } finally { storageLoading = false; }
  }
  $effect(() => {
    if (tab === "account") loadStorage();
  });
  function downloadExport() {
    window.location.href = "/api/account/export";
  }
  async function destroyAccount() {
    const r = await fetch("/api/account/destroy", { method: "POST" });
    const j = await r.json().catch(() => ({}));
    window.location.href = j.redirect ?? "/login";
  }
  function fmtTs(ms: number): string {
    return new Date(ms).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
  }

  // Tiny User-Agent parser. We only care about the rough categories the user
  // would use to recognise the device — full UA parsing is overkill for this.
  function parseUa(ua: string | null): { browser: string; os: string; device: string } {
    if (!ua) return { browser: "Unbekannt", os: "Unbekannt", device: "Unbekannt" };
    let browser = "Unbekannt";
    if (/Edg\//.test(ua)) browser = "Edge";
    else if (/OPR\/|Opera/.test(ua)) browser = "Opera";
    else if (/Firefox\//.test(ua)) browser = "Firefox";
    else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = "Chrome";
    else if (/Safari\//.test(ua) && /Version\//.test(ua)) browser = "Safari";
    else if (/curl|wget|HTTPie|node-fetch|axios/i.test(ua)) browser = ua.split("/")[0] ?? "CLI";

    let os = "Unbekannt";
    if (/Windows NT 10/.test(ua)) os = "Windows 10/11";
    else if (/Windows NT/.test(ua)) os = "Windows";
    else if (/Mac OS X|Macintosh/.test(ua)) os = "macOS";
    else if (/Android/.test(ua)) os = "Android";
    else if (/iPhone|iPad|iOS/.test(ua)) os = "iOS";
    else if (/Linux/.test(ua)) os = "Linux";

    let device = "Desktop";
    if (/Mobi|iPhone|Android.*Mobile/.test(ua)) device = "Smartphone";
    else if (/iPad|Tablet/.test(ua)) device = "Tablet";
    return { browser, os, device };
  }

  let revokingDevice = $state<string | null>(null);
  async function revokeDevice(device_id: string) {
    if (revokingDevice) return;
    revokingDevice = device_id;
    try {
      const r = await fetch(`/api/sessions/${encodeURIComponent(device_id)}`, { method: "DELETE" });
      if (r.ok && storage) {
        storage = {
          ...storage,
          account: {
            ...storage.account,
            devices: {
              ...storage.account.devices,
              count: storage.account.devices.count - 1,
              records: storage.account.devices.records.filter((d) => d.device_id !== device_id),
            },
          },
        };
      }
    } finally {
      revokingDevice = null;
    }
  }

  type Tab = "profile" | "mail" | "stundenplan" | "connections" | "navigation" | "account";
  const SECTIONS = [
    ["profile", "Profil", "settings"],
    ["mail", "Mail", "mail"],
    ["stundenplan", "Stundenplan", "table"],
    ["connections", "Verbindungen", "send"],
    ["navigation", "Navigation", "list-check"],
    ["account", "Account", "logout"],
  ] as const;
  const TABS: ReadonlySet<Tab> = new Set(SECTIONS.map(([k]) => k));
  const tab = $derived.by<Tab>(() => {
    const t = page.url.searchParams.get("tab");
    return TABS.has(t as Tab) ? (t as Tab) : "profile";
  });
  const currentLabel = $derived(SECTIONS.find(([k]) => k === tab)?.[1] ?? "Einstellungen");
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

<div class="grid h-full grid-cols-1 md:[grid-template-columns:240px_1fr]">
  <!-- Section nav: collapsible <details> on mobile, static rail at md+ -->
  <details class="border-b border-zinc-800 bg-zinc-900/30 md:hidden">
    <summary class="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold">
      <span>Einstellungen · {currentLabel}</span>
      <Icon name="chevron-down" size={16} />
    </summary>
    <nav class="border-t border-zinc-800 p-2">
      {#each SECTIONS as [k, label, icon]}
        <button
          class="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition
            {tab === k ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'}"
          onclick={() => setTab(k as Tab)}
        >
          <Icon name={icon} size={16} />
          {label}
        </button>
      {/each}
    </nav>
  </details>

  <!-- Tab rail -->
  <aside class="hidden h-full flex-col border-r border-zinc-800 bg-zinc-900/30 p-3 md:flex">
    <h1 class="mb-3 px-2 text-base font-semibold tracking-tight">Einstellungen</h1>
    {#each SECTIONS as [k, label, icon]}
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
    <div class="mx-auto max-w-2xl px-4 py-4 md:px-8 md:py-8">
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
      {:else if tab === "stundenplan"}
        <h2 class="mb-1 text-xl font-semibold tracking-tight">Stundenplan</h2>
        <p class="mb-4 text-sm text-zinc-400">
          OpenSax holt Plan und Vertretungen direkt vom DaVinci-Server deiner Schule.
          Endpoint und Zugangsdaten bekommst du von der Schule — sie sind dieselben wie in der DaVinci-App.
        </p>

        <!-- `tab` rides along in the action URL so a submit that isn't enhanced
             (no JS yet, stale tab) still comes back to this tab instead of
             dumping the user on Profil with an orphaned error. -->
        <form method="POST" action="?/saveDavinci&tab=stundenplan" use:enhance class="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
          <label class="block">
            <span class="mb-1 block text-xs text-zinc-400">Endpoint</span>
            <input
              name="endpoint"
              value={data.davinci?.endpoint ?? ""}
              placeholder="schule.example.de  oder  http://host/daVinciIS.dll"
              class="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-sm outline-none focus:border-indigo-500"
            />
            <span class="mt-1 block text-[11px] text-zinc-500">
              Host oder Adresse des HTML-Vertretungsplans. Ohne Schema wird erst HTTPS, dann HTTP
              probiert — mit <code>https://</code> oder <code>http://</code> davor bleibt es dabei.
            </span>
            {#if data.davinci?.resolvedEndpoint}
              <span class="mt-1 block text-[11px] text-zinc-500">
                Erkannt als
                <span class="text-zinc-400">
                  {data.davinci.sourceType === "html" ? "HTML-Export" : "InfoServer"}
                </span>
                · <code class="text-zinc-400">{data.davinci.resolvedEndpoint}</code>
              </span>
            {/if}
          </label>

          <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label class="block">
              <span class="mb-1 block text-xs text-zinc-400">Benutzername</span>
              <input
                name="username"
                value={data.davinci?.username ?? ""}
                class="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-sm outline-none focus:border-indigo-500"
              />
              <span class="mt-1 block text-[11px] text-zinc-500">
                Exakt wie angegeben — Leerzeichen am Ende zählen mit.
              </span>
            </label>
            <label class="block">
              <span class="mb-1 block text-xs text-zinc-400">Passwort</span>
              <input
                name="password"
                type="password"
                autocomplete="off"
                placeholder={data.davinci?.hasPassword ? "••••••••" : ""}
                class="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-sm outline-none focus:border-indigo-500"
              />
              <span class="mt-1 block text-[11px] text-zinc-500">
                {data.davinci?.hasPassword ? "Leer lassen, um das gespeicherte zu behalten." : "Wird verschlüsselt gespeichert."}
              </span>
            </label>
          </div>

          <fieldset class="border-t border-zinc-800 pt-4">
            <legend class="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Ansicht</legend>
            <p class="mb-3 text-[11px] text-zinc-500">
              Leer lassen, wenn dein Zugang schon einer Klasse oder Lehrkraft zugeordnet ist — dann erkennt
              OpenSax das automatisch.
            </p>
            <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label class="block">
                <span class="mb-1 block text-xs text-zinc-400">Klasse</span>
                <input
                  name="classCode"
                  value={data.davinci?.classCode ?? ""}
                  placeholder="z.B. IT 25/3"
                  class="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                />
              </label>
              <label class="block">
                <span class="mb-1 block text-xs text-zinc-400">Lehrer-Kürzel</span>
                <input
                  name="teacherCode"
                  value={data.davinci?.teacherCode ?? ""}
                  placeholder="z.B. Loh"
                  class="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                />
              </label>
            </div>
            <label class="mt-3 flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                name="includeSupervisions"
                value="1"
                checked={data.davinci?.includeSupervisions ?? false}
                class="rounded border-zinc-700 bg-zinc-950"
              />
              Aufsichten mit anzeigen
            </label>
          </fieldset>

          {#if form?.scope === "davinci" && form?.error}
            <p class="text-xs text-rose-400">{form.error}</p>
          {/if}
          {#if form?.ok && form?.scope === "davinci"}
            <div class="rounded-lg border border-emerald-900/60 bg-emerald-950/20 p-3 text-xs text-emerald-300">
              <p class="font-medium">Verbunden.</p>
              <p class="mt-1 text-emerald-300/80">
                {form.info?.scheduleDescription ?? "Stundenplan"} ·
                {form.info?.lessonCount ?? 0} Unterrichtsserien ·
                Profil „{form.info?.profile ?? "?"}"
                {#if form.info?.identity}· als {form.info.identity}{/if}
              </p>
            </div>
          {/if}
          {#if form?.ok && form?.scope === "davinci-cleared"}
            <p class="text-xs text-zinc-400">Verbindung entfernt.</p>
          {/if}

          <div class="flex justify-end gap-2 pt-1">
            {#if data.davinci}
              <button
                formaction="?/clearDavinci&tab=stundenplan"
                class="rounded-md border border-zinc-800 px-4 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
              >
                Entfernen
              </button>
            {/if}
            <button class="rounded-md bg-indigo-500 px-4 py-1.5 text-sm font-medium hover:bg-indigo-400">
              Testen &amp; speichern
            </button>
          </div>
        </form>
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
          <div class="mb-1 flex items-center justify-between gap-2">
            <h3 class="text-xs font-semibold uppercase tracking-wide text-zinc-500">Layout</h3>
            <span class="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-400">Nur für Desktop-Geräte</span>
          </div>
          <p class="mb-3 text-xs text-zinc-500">Auf Mobilgeräten wird immer die untere Tab-Leiste mit Menü verwendet.</p>
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
          <div class="mb-1 flex items-center justify-between">
            <h3 class="text-xs font-semibold uppercase tracking-wide text-zinc-500">Tabs</h3>
            <p class="text-xs text-zinc-500">Drag &amp; Drop zum Verschieben</p>
          </div>
          <p class="mb-3 text-xs text-zinc-500">Reihenfolge &amp; Sichtbarkeit gelten auch für die untere Leiste auf dem Handy (erste Einträge zuerst).</p>

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

        <section class="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
          <h3 class="mb-1 text-sm font-semibold uppercase tracking-wide text-zinc-400">Andere Sitzungen</h3>
          <p class="mb-4 text-sm text-zinc-400">
            Alle Geräte, die aktuell mit deinem LernSax-Account angemeldet sind. Sitzungen sind 365 Tage gültig.
          </p>
          {#if !storage}
            <p class="text-sm text-zinc-500">{storageLoading ? "Lade…" : ""}</p>
          {:else if storage.account.devices.records.length === 0}
            <p class="text-sm text-zinc-500">Keine aktiven Sitzungen gefunden.</p>
          {:else}
            <ul class="space-y-2">
              {#each storage.account.devices.records as d}
                {@const ua = parseUa(d.userAgent)}
                <li class="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
                  <div class="min-w-0 flex-1 space-y-1 text-sm">
                    <p class="font-medium">
                      {ua.device} · {ua.os} · {ua.browser}
                      {#if d.current}
                        <span class="ml-2 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">dieses Gerät</span>
                      {/if}
                    </p>
                    <dl class="grid grid-cols-[110px_1fr] gap-x-3 gap-y-0.5 text-xs text-zinc-500">
                      <dt>IP (Anmeldung)</dt><dd class="font-mono text-zinc-400">{d.firstIp ?? "—"}</dd>
                      {#if d.lastIp && d.lastIp !== d.firstIp}
                        <dt>IP (zuletzt)</dt><dd class="font-mono text-zinc-400">{d.lastIp}</dd>
                      {/if}
                      <dt>Erste Anmeldung</dt><dd class="text-zinc-400">{fmtTs(d.createdAt)}</dd>
                      <dt>Zuletzt aktiv</dt><dd class="text-zinc-400">{fmtTs(d.lastSeen)}</dd>
                      {#if d.userAgent}
                        <dt>User-Agent</dt><dd class="break-all text-[10px] text-zinc-500">{d.userAgent}</dd>
                      {/if}
                    </dl>
                  </div>
                  {#if !d.current}
                    <button
                      onclick={() => revokeDevice(d.device_id)}
                      disabled={revokingDevice === d.device_id}
                      class="shrink-0 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/20 disabled:opacity-50"
                    >{revokingDevice === d.device_id ? "Melde ab…" : "Abmelden"}</button>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </section>

        <section class="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
          <h3 class="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">Daten</h3>

          {#if !storage}
            <p class="text-sm text-zinc-500">{storageLoading ? "Lade…" : ""}</p>
          {:else}
            <div class="space-y-4 text-sm">
              <div>
                <p class="font-medium">Sitzungen — {storage.account.devices.count} aktive{storage.account.devices.count === 1 ? 's Gerät' : ' Geräte'} ({storage.session.ttl_days} Tage gültig)</p>
                <p class="text-xs text-zinc-500">
                  Anmelde-Cookie <code>{storage.session.cookie.name}</code> · HttpOnly · Secure · SameSite={storage.session.cookie.same_site}.
                  Details und Abmelden im Bereich „Andere Sitzungen" oben.
                </p>
                <ul class="mt-1 space-y-0.5 text-xs text-zinc-500">
                  {#each storage.session.stored as line}<li>· {line}</li>{/each}
                </ul>
              </div>

              <div>
                <p class="font-medium">MCP-Verbindungen ({storage.connections.count})</p>
                <p class="text-xs text-zinc-500">{storage.connections.scope ?? "pro LernSax-Account"}.</p>
                <ul class="mt-1 space-y-0.5 text-xs text-zinc-500">
                  {#each storage.connections.stored as line}<li>· {line}</li>{/each}
                </ul>
                {#if storage.connections.records.length}
                  <ul class="mt-2 space-y-1 text-xs text-zinc-400">
                    {#each storage.connections.records as c}
                      <li>· {c.client_name} — letzte Nutzung {fmtTs(c.last_used_at)}</li>
                    {/each}
                  </ul>
                {/if}
              </div>

              <div>
                <p class="font-medium">Zwischenspeicher (nur Arbeitsspeicher, nichts auf der Festplatte)</p>
                <ul class="mt-1 space-y-1 text-xs text-zinc-500">
                  {#each Object.entries(storage.cache) as [name, c]}
                    <li>
                      · <span class="text-zinc-400">{name}</span>
                      — Gültigkeit {c.ttl_seconds ? `${c.ttl_seconds}s` : c.ttl_minutes ? `${c.ttl_minutes} min` : "—"},
                      {c.scope}.
                    </li>
                  {/each}
                </ul>
              </div>

              <div>
                <p class="font-medium">Wird nicht gespeichert</p>
                <ul class="mt-1 space-y-1 text-xs text-zinc-500">
                  {#each storage.not_stored as line}<li>· {line}</li>{/each}
                </ul>
              </div>
            </div>
          {/if}

          <div class="mt-5 flex flex-wrap gap-2">
            <button
              onclick={downloadExport}
              class="rounded-md border border-zinc-700 bg-zinc-900 px-4 py-1.5 text-sm font-medium hover:bg-zinc-800"
            >Daten herunterladen</button>
            {#if !confirming}
              <button
                onclick={() => (confirming = true)}
                class="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-1.5 text-sm font-medium text-red-300 hover:bg-red-500/20"
              >Alle Daten löschen</button>
            {:else}
              <span class="text-sm text-zinc-400">Sicher? Das meldet alle Geräte ab und löscht alle Verbindungen.</span>
              <button
                onclick={destroyAccount}
                class="rounded-md border border-red-500 bg-red-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-400"
              >Endgültig löschen</button>
              <button
                onclick={() => (confirming = false)}
                class="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-100"
              >Abbrechen</button>
            {/if}
          </div>
        </section>
      {/if}
    </div>
  </section>
</div>
