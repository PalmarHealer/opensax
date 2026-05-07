<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";

  let { data } = $props();
  let email = $state("");
  let password = $state("");
  let busy = $state(false);
  let error = $state<string | null>(null);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = null;
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        error = body.error ?? `HTTP ${res.status}`;
        return;
      }
      const next = new URLSearchParams(page.url.search).get("next") || "/";
      await goto(next, { replaceState: true, invalidateAll: true });
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<div class="grid h-full place-items-center px-6">
  <div class="w-full max-w-sm">
    <div class="mb-8 text-center">
      <div class="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-indigo-500/10 text-2xl">⌁</div>
      <h1 class="text-xl font-semibold tracking-tight">OpenSax</h1>
      <p class="mt-1 text-sm text-zinc-400">Login mit deinem LernSax-Account</p>
    </div>

    <form onsubmit={submit} class="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
      <label class="block">
        <span class="mb-1 block text-xs font-medium text-zinc-400">E-Mail</span>
        <input
          type="email"
          bind:value={email}
          required
          autocomplete="username"
          class="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500"
          placeholder="vorname.nachname@schule.lernsax.de"
        />
      </label>
      <label class="block">
        <span class="mb-1 block text-xs font-medium text-zinc-400">Passwort</span>
        <input
          type="password"
          bind:value={password}
          required
          autocomplete="current-password"
          class="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500"
        />
      </label>

      {#if error}
        <p class="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>
      {/if}

      <button
        type="submit"
        disabled={busy}
        class="w-full rounded-lg bg-indigo-500 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
      >
        {busy ? "Bitte warten…" : "Einloggen"}
      </button>

      <p class="text-center text-xs text-zinc-500">
        Credentials werden serverseitig verschlüsselt gespeichert.{#if data.secureContext} Cookie ist HttpOnly + Secure.{/if}
      </p>
    </form>
  </div>
</div>
