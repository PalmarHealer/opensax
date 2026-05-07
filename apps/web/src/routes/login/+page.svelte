<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";

  let { data } = $props();
  let email = $state("");
  let password = $state("");
  let busy = $state(false);
  let error = $state<string | null>(null);
  let cookiesOk = $state(false);
  let cookieInfoOpen = $state(false);

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

      <label class="flex items-center gap-2 text-xs text-zinc-400">
        <input type="checkbox" bind:checked={cookiesOk} required class="h-4 w-4 accent-indigo-500" />
        <span>Cookies zulassen</span>
        <button
          type="button"
          onclick={() => (cookieInfoOpen = true)}
          class="grid h-4 w-4 cursor-pointer place-items-center rounded-full border border-zinc-700 text-[10px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
          aria-label="Cookie-Info"
        >?</button>
      </label>

      <button
        type="submit"
        disabled={busy || !cookiesOk}
        class="w-full rounded-lg bg-indigo-500 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
      >
        {busy ? "Bitte warten…" : "Einloggen"}
      </button>

      <p class="text-center text-xs text-zinc-500">
        Credentials werden serverseitig verschlüsselt gespeichert.
      </p>
    </form>
  </div>
</div>

{#if cookieInfoOpen}
  <div class="fixed inset-0 z-40 bg-black/60" onclick={() => (cookieInfoOpen = false)} role="presentation"></div>
  <div class="fixed left-1/2 top-1/2 z-50 w-[min(440px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl" role="dialog">
    <h2 class="mb-2 text-base font-semibold">Wofür Cookies?</h2>
    <p class="text-sm text-zinc-300">
      OpenSax verwendet Cookies ausschließlich funktional — kein Tracking, keine Analytics, keine Drittanbieter.
    </p>
    <ul class="mt-3 space-y-2 text-sm text-zinc-300">
      <li><span class="font-medium">lernsax_sid</span> <span class="text-xs text-zinc-500">(HttpOnly · Secure · SameSite=Lax)</span><br /><span class="text-xs text-zinc-400">Session-Cookie. Verknüpft den Browser mit der serverseitig verschlüsselten Anmeldung. Ohne diesen Cookie ist kein Login möglich. Lebensdauer: 30 Tage oder bis zum Abmelden.</span></li>
      <li><span class="font-medium">localStorage</span> <span class="text-xs text-zinc-500">(im Browser, kein Server)</span><br /><span class="text-xs text-zinc-400">Speichert nur deine Theme- und Navigations-Einstellungen. Wird nie an den Server geschickt.</span></li>
    </ul>
    <p class="mt-3 text-xs text-zinc-500">
      Es werden keine Werbe- oder Tracking-Cookies gesetzt. Daten kannst du jederzeit unter Einstellungen → Account → Daten herunterladen oder löschen.
    </p>
    <div class="mt-4 flex justify-end">
      <button onclick={() => (cookieInfoOpen = false)} class="rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-400">Verstanden</button>
    </div>
  </div>
{/if}
