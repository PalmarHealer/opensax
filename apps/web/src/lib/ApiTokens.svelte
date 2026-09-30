<script lang="ts">
  /**
   * Create an API token: name, expiry, and which tools it may call — every
   * tool is its own scope. The bare token is shown exactly once.
   */
  interface ToolInfo { name: string; description: string; category: string; readOnly: boolean }

  let { onCreated }: { onCreated?: () => void } = $props();

  let open = $state(false);
  let tools = $state<ToolInfo[]>([]);
  let catalogError = $state<string | null>(null);
  let loadingCatalog = $state(false);

  let name = $state("");
  let expiry = $state<"7" | "30" | "90" | "365" | "custom" | "never">("90");
  let customDate = $state("");
  let selected = $state<Set<string>>(new Set());
  let saving = $state(false);
  let error = $state<string | null>(null);
  let created = $state<string | null>(null);
  let copied = $state(false);

  const groups = $derived.by(() => {
    const m = new Map<string, ToolInfo[]>();
    for (const t of tools) {
      const list = m.get(t.category) ?? [];
      list.push(t);
      m.set(t.category, list);
    }
    return [...m];
  });

  async function start() {
    open = true;
    created = null;
    error = null;
    name = "";
    expiry = "90";
    customDate = "";
    selected = new Set();
    if (tools.length || loadingCatalog) return;
    loadingCatalog = true;
    try {
      const r = await fetch("/api/connections/catalog");
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      tools = d.tools ?? [];
      catalogError = null;
    } catch (e) {
      catalogError = (e as Error).message;
    } finally {
      loadingCatalog = false;
    }
  }

  function toggle(n: string) {
    const s = new Set(selected);
    if (s.has(n)) s.delete(n);
    else s.add(n);
    selected = s;
  }
  function setGroup(list: ToolInfo[], on: boolean) {
    const s = new Set(selected);
    for (const t of list) on ? s.add(t.name) : s.delete(t.name);
    selected = s;
  }
  function preset(kind: "read" | "all" | "none") {
    if (kind === "none") selected = new Set();
    // `raw_call` bypasses every other scope — never part of a preset.
    else selected = new Set(tools.filter((t) => t.name !== "raw_call" && (kind === "all" || t.readOnly)).map((t) => t.name));
  }

  function expiresAt(): number | null {
    if (expiry === "never") return 0;
    if (expiry === "custom") {
      if (!customDate) return null;
      // End of the chosen day, local time.
      const d = new Date(`${customDate}T23:59:59`);
      return Number.isNaN(d.getTime()) ? null : d.getTime();
    }
    return Date.now() + Number(expiry) * 86_400_000;
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    const expires_at = expiresAt();
    if (expires_at === null) { error = "Bitte ein Ablaufdatum wählen."; return; }
    saving = true;
    try {
      const r = await fetch("/api/connections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, scopes: [...selected], expires_at }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      created = d.token;
      onCreated?.();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      saving = false;
    }
  }

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch { /* noop */ }
  }

  const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
</script>

<section class="mb-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
  <div class="mb-2 flex items-center justify-between gap-3">
    <h3 class="text-sm font-semibold uppercase tracking-wide text-zinc-400">API-Tokens</h3>
    {#if !open}
      <button onclick={start} class="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs font-medium hover:bg-zinc-800">
        Neues Token
      </button>
    {/if}
  </div>
  <p class="text-xs text-zinc-500">
    Für eigene Skripte und Programme. Ein Token darf genau die Tools aufrufen, die du ihm erlaubst, und läuft ab, wann du willst.
    Es nutzt deine gespeicherte Anmeldung — solange du auf mindestens einem Gerät angemeldet bist, funktioniert es.
  </p>

  {#if open && created}
    <div class="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4">
      <p class="mb-2 text-sm font-medium text-emerald-300">Token erstellt — kopiere es jetzt, es wird nur dieses eine Mal angezeigt.</p>
      <div class="flex items-stretch gap-2">
        <code class="flex-1 break-all rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs">{created}</code>
        <button onclick={copy} class="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-medium hover:bg-zinc-800">
          {copied ? "Kopiert" : "Kopieren"}
        </button>
      </div>
      <button onclick={() => { open = false; created = null; }} class="mt-3 text-xs text-zinc-400 hover:text-zinc-100">Fertig</button>
    </div>
  {:else if open}
    <form onsubmit={submit} class="mt-4 space-y-4">
      <label class="block">
        <span class="mb-1 block text-xs text-zinc-400">Name</span>
        <input
          bind:value={name}
          required
          maxlength="80"
          placeholder="z.B. Home-Assistant, Stundenplan-Skript"
          class="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500"
        />
      </label>

      <div class="grid gap-3 sm:grid-cols-2">
        <label class="block">
          <span class="mb-1 block text-xs text-zinc-400">Läuft ab</span>
          <select bind:value={expiry} class="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500">
            <option value="7">in 7 Tagen</option>
            <option value="30">in 30 Tagen</option>
            <option value="90">in 90 Tagen</option>
            <option value="365">in einem Jahr</option>
            <option value="custom">am …</option>
            <option value="never">nie</option>
          </select>
        </label>
        {#if expiry === "custom"}
          <label class="block">
            <span class="mb-1 block text-xs text-zinc-400">Datum</span>
            <input type="date" bind:value={customDate} min={tomorrow()} required class="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
          </label>
        {/if}
      </div>
      {#if expiry === "never"}
        <p class="text-[11px] text-amber-300/80">Ein Token ohne Ablauf gilt, bis du es widerrufst. Gib ihm nur die Tools, die es wirklich braucht.</p>
      {/if}

      <div>
        <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span class="text-xs text-zinc-400">Berechtigungen ({selected.size} von {tools.length})</span>
          <div class="flex gap-1 text-[11px]">
            <button type="button" onclick={() => preset("read")} class="rounded border border-zinc-800 px-2 py-0.5 text-zinc-400 hover:text-zinc-100">Nur lesen</button>
            <button type="button" onclick={() => preset("all")} class="rounded border border-zinc-800 px-2 py-0.5 text-zinc-400 hover:text-zinc-100">Alles</button>
            <button type="button" onclick={() => preset("none")} class="rounded border border-zinc-800 px-2 py-0.5 text-zinc-400 hover:text-zinc-100">Keine</button>
          </div>
        </div>
        {#if loadingCatalog}
          <p class="py-3 text-center text-sm text-zinc-500">Lade…</p>
        {:else if catalogError}
          <p class="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{catalogError}</p>
        {:else}
          <div class="max-h-96 space-y-3 overflow-auto rounded-md border border-zinc-800 bg-zinc-950/50 p-3">
            {#each groups as [category, list]}
              {@const all = list.every((t) => selected.has(t.name))}
              <fieldset>
                <label class="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={all} onchange={() => setGroup(list, !all)} class="accent-indigo-500" />
                  {category}
                </label>
                <ul class="mt-1 space-y-1 pl-6">
                  {#each list as t}
                    <li>
                      <label class="flex items-start gap-2 text-xs">
                        <input type="checkbox" checked={selected.has(t.name)} onchange={() => toggle(t.name)} class="mt-0.5 accent-indigo-500" />
                        <span class="min-w-0">
                          <code class="text-zinc-300">{t.name}</code>
                          <span class="ml-1 rounded-full border border-zinc-800 px-1.5 text-[10px] {t.readOnly ? 'text-zinc-500' : 'text-amber-300/80'}">{t.readOnly ? "lesen" : "ändern"}</span>
                          <span class="block text-zinc-500">{t.description}</span>
                        </span>
                      </label>
                    </li>
                  {/each}
                </ul>
              </fieldset>
            {/each}
          </div>
        {/if}
      </div>

      {#if error}
        <p class="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>
      {/if}

      <div class="flex gap-2">
        <button
          type="submit"
          disabled={saving || !name.trim() || selected.size === 0}
          class="rounded-md bg-indigo-500 px-4 py-1.5 text-sm font-medium hover:bg-indigo-400 disabled:opacity-50"
        >{saving ? "Erstelle…" : "Token erstellen"}</button>
        <button type="button" onclick={() => (open = false)} class="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-100">Abbrechen</button>
      </div>
    </form>
  {/if}
</section>
