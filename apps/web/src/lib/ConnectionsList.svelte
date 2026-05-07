<script lang="ts">
  import { onMount } from "svelte";
  import Icon from "./Icon.svelte";

  interface Connection {
    id: string;
    client_name: string;
    scopes: string[];
    created_at: number;
    last_used_at: number;
  }

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
  async function revoke(id: string) {
    if (!confirm("Diese Verbindung widerrufen?")) return;
    const r = await fetch(`/api/connections/${id}`, { method: "DELETE" });
    if (r.ok) await reload();
  }
  onMount(reload);

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
    <h3 class="text-sm font-semibold uppercase tracking-wide text-zinc-400">Autorisierte Connections</h3>
    <button onclick={reload} class="rounded p-1 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200" title="Aktualisieren">
      <Icon name="refresh" size={14} />
    </button>
  </div>
  {#if loading}
    <p class="py-4 text-center text-sm text-zinc-500">Lade…</p>
  {:else if error}
    <p class="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>
  {:else if connections.length === 0}
    <p class="py-4 text-center text-sm text-zinc-500">Keine Verbindungen autorisiert.</p>
  {:else}
    <ul class="divide-y divide-zinc-800">
      {#each connections as c}
        <li class="flex items-center justify-between gap-3 py-3">
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">{c.client_name}</p>
            <p class="text-xs text-zinc-500">
              Erstellt: {fmt(c.created_at)}
              · zuletzt verwendet: {fmtRel(c.last_used_at)}
            </p>
            {#if c.scopes.length}
              <div class="mt-1 flex flex-wrap gap-1">
                {#each c.scopes as s}
                  <span class="rounded-full border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-[10px] text-zinc-400">{s}</span>
                {/each}
              </div>
            {/if}
          </div>
          <button
            onclick={() => revoke(c.id)}
            class="rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-xs text-red-300 hover:bg-red-500/20"
          >Widerrufen</button>
        </li>
      {/each}
    </ul>
  {/if}
</section>
