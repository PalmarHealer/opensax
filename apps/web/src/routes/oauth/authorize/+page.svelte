<script lang="ts">
  import { avatarColor, initials } from "$lib/avatar";
  import Icon from "$lib/Icon.svelte";

  let { data } = $props();
  const colors = $derived(avatarColor(data.user.email || data.user.displayName));

  const SCOPE_DESCRIPTIONS: Record<string, { label: string; lines: string[] }> = {
    lernsax: {
      label: "Vollzugriff auf dein LernSax-Konto",
      lines: [
        "Mails lesen, schreiben, organisieren",
        "Aufgaben, Kalender, Notizen, Mitteilungen anlegen und ändern",
        "Dateien (Persönlich + alle Räume) lesen, hochladen, bearbeiten, löschen",
        "Chat-Nachrichten lesen und schreiben",
      ],
    },
  };
</script>

<div class="grid h-full place-items-center px-6 py-10">
  <div class="w-full max-w-md">
    <div class="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 shadow-xl">
      <div class="mb-5 flex items-center gap-3">
        <div class="grid h-10 w-10 place-items-center rounded-xl bg-indigo-500/15 text-indigo-300 text-lg">⌁</div>
        <div class="min-w-0 flex-1">
          <p class="text-xs font-semibold uppercase tracking-wide text-zinc-500">Verbindung autorisieren</p>
          <h1 class="truncate text-lg font-semibold">{data.client_name}</h1>
        </div>
      </div>

      <p class="mb-4 text-sm text-zinc-300">
        <span class="font-semibold">{data.client_name}</span> möchte über OpenSax auf dein Konto zugreifen.
      </p>

      <div class="mb-4 rounded-xl border border-zinc-800 bg-zinc-950 p-3">
        <p class="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Berechtigungen</p>
        <ul class="space-y-2">
          {#each data.scopes as s}
            {@const info = SCOPE_DESCRIPTIONS[s] ?? { label: s, lines: [] }}
            <li>
              <p class="text-sm font-medium text-zinc-200">{info.label}</p>
              {#if info.lines.length}
                <ul class="mt-1 space-y-0.5 pl-4 text-xs text-zinc-500">
                  {#each info.lines as l}
                    <li class="list-disc">{l}</li>
                  {/each}
                </ul>
              {/if}
            </li>
          {/each}
        </ul>
      </div>

      <div class="mb-5 flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2">
        <div class="grid h-9 w-9 place-items-center rounded-full text-sm font-semibold"
             style="background: {colors.bg}; color: {colors.fg};">
          {initials(data.user.displayName, data.user.email)}
        </div>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium">{data.user.displayName || "—"}</p>
          <p class="truncate text-xs text-zinc-500">{data.user.email}</p>
        </div>
      </div>

      <p class="mb-4 text-xs text-zinc-500">
        Du kannst diese Verbindung jederzeit unter <span class="text-zinc-300">Einstellungen → Verbindungen</span> widerrufen.
      </p>

      <div class="flex gap-2">
        <form method="POST" action="?/deny" class="flex-1">
          {#each Object.entries(data.raw) as [k, v]}
            <input type="hidden" name={k} value={v} />
          {/each}
          <button type="submit" class="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800">
            Ablehnen
          </button>
        </form>
        <form method="POST" action="?/approve" class="flex-1">
          {#each Object.entries(data.raw) as [k, v]}
            <input type="hidden" name={k} value={v} />
          {/each}
          <button type="submit" class="flex w-full items-center justify-center gap-1.5 rounded-md bg-indigo-500 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-400">
            Erlauben
            <Icon name="chevron-right" size={14} />
          </button>
        </form>
      </div>
    </div>
  </div>
</div>
