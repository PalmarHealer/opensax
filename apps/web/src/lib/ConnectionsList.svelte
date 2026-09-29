<script lang="ts">
  import { untrack } from "svelte";
  import Icon from "./Icon.svelte";

  interface Connection {
    id: string;
    kind: "oauth" | "token";
    client_name: string;
    scopes: string[];
    created_at: number;
    last_used_at: number;
    expires_at: number;
  }

  /** Bump to make the list reload, e.g. after a token was created. */
  let { reloadKey = 0 }: { reloadKey?: number } = $props();

  let connections = $state<Connection[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  async function reload() {
    loading = true;
    try {
      const r = await fetch("/api/connections");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      connections = d.connections ?? [];
      error = null;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }
  async function revoke(c: Connection) {
    if (!confirm(c.kind === "token" ? `Token „${c.client_name}“ löschen? Programme, die es nutzen, verlieren sofort den Zugriff.` : "Diese Verbindung widerrufen?")) return;
    const id = c.id;
    const r = await fetch(`/api/connections/${id}`, { method: "DELETE" });
    if (r.ok) await reload();
  }
  // Runs on mount and again whenever the parent bumps `reloadKey`.
  $effect(() => {
    void reloadKey;
    untrack(reload);
  });

  let expanded = $state<Set<string>>(new Set());
  function toggleScopes(id: string) {
    const s = new Set(expanded);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    expanded = s;
  }
  function expiryLabel(ts: number): { text: string; expired: boolean } {
    if (!ts) return { text: "läuft nie ab", expired: false };
    if (ts < Date.now()) return { text: `abgelaufen am ${new Date(ts).toLocaleDateString("de-DE", { dateStyle: "medium" })}`, expired: true };
    return { text: `läuft ab am ${new Date(ts).toLocaleDateString("de-DE", { dateStyle: "medium" })}`, expired: false };
  }

  function fmt(ts: number): string {
    if (!ts) return "—";
    return new Date(ts).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
  }
  function fmtRel(ts: number): string {
    if (!ts) return "nie";
    const d = Math.floor((Date.now() - ts) / 1000);
    if (d < 60) return "gerade eben";
    if (d < 3600) return `vor ${Math.floor(d / 60)}m`;
    if (d < 86400) return `vor ${Math.floor(d / 3600)}h`;
    return new Date(ts).toLocaleDateString("de-DE", { dateStyle: "medium" });
  }
</script>

<section class="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
  <div class="mb-3 flex items-center justify-between">
    <h3 class="text-sm font-semibold uppercase tracking-wide text-zinc-400">Verbindungen &amp; Tokens</h3>
    <button onclick={reload} class="rounded p-1 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200" title="Aktualisieren">
      <Icon name="refresh" size={14} />
    </button>
  </div>
  {#if loading}
    <p class="py-4 text-center text-sm text-zinc-500">Lade…</p>
  {:else if error}
    <p class="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>
  {:else if connections.length === 0}
    <p class="py-4 text-center text-sm text-zinc-500">Keine Verbindungen oder Tokens.</p>
  {:else}
    <ul class="divide-y divide-zinc-800">
      {#each connections as c}
        {@const exp = expiryLabel(c.expires_at)}
        <li class="flex items-center justify-between gap-3 py-3">
          <div class="min-w-0 flex-1">
            <p class="flex items-center gap-2 text-sm font-medium">
              <span class="truncate">{c.client_name}</span>
              <span class="shrink-0 rounded-full border border-zinc-800 px-1.5 py-0.5 text-[10px] font-normal text-zinc-500">{c.kind === "token" ? "API-Token" : "OAuth"}</span>
            </p>
            <p class="text-xs text-zinc-500">
              Erstellt: {fmt(c.created_at)}
              · zuletzt verwendet: {fmtRel(c.last_used_at)}
              {#if c.kind === "token" || c.expires_at}
                · <span class={exp.expired ? "text-red-400" : ""}>{exp.text}</span>
              {/if}
            </p>
            {#if c.scopes.length > 6 && !expanded.has(c.id)}
              <button onclick={() => toggleScopes(c.id)} class="mt-1 text-[11px] text-zinc-400 hover:text-zinc-100">
                {c.scopes.length} Berechtigungen anzeigen
              </button>
            {:else if c.scopes.length}
              <div class="mt-1 flex flex-wrap gap-1">
                {#each c.scopes as s}
                  <span class="rounded-full border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-[10px] text-zinc-400">{s}</span>
                {/each}
                {#if c.scopes.length > 6}
                  <button onclick={() => toggleScopes(c.id)} class="text-[10px] text-zinc-500 hover:text-zinc-100">weniger</button>
                {/if}
              </div>
            {/if}
          </div>
          <button
            onclick={() => revoke(c)}
            class="rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-xs text-red-300 hover:bg-red-500/20"
          >{c.kind === "token" ? "Löschen" : "Widerrufen"}</button>
        </li>
      {/each}
    </ul>
  {/if}
</section>
