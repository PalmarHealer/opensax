<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import Icon from "$lib/Icon.svelte";
  import { theme } from "$lib/themeStore.svelte";

  let { data } = $props();
  let placeholder: HTMLDivElement;
  let editor = $state<{ destroyEditor?: () => void; setTheme?: (id: string) => void } | null>(null);
  let status = $state<"loading" | "ready" | "error">("loading");
  let errorMsg = $state<string | null>(null);

  function ooThemeId(eff: "light" | "dark"): string {
    return eff === "dark" ? "theme-dark" : "theme-light";
  }

  onMount(() => {
    theme.init();
    const script = document.createElement("script");
    script.src = data.apiJsUrl;
    script.async = true;
    script.onload = () => {
      try {
        const cfg = {
          ...data.editorConfig,
          width: "100%",
          height: "100%",
          events: {
            onAppReady: () => {
              status = "ready";
              // Force-apply our current theme — OO sometimes ignores the
              // customization.uiTheme on first paint and falls back to its
              // default until told otherwise.
              try { editor?.setTheme?.(ooThemeId(theme.effective)); } catch {}
            },
            onError: (e: { data?: { errorCode?: number; errorDescription?: string } }) => {
              status = "error";
              errorMsg = e.data?.errorDescription ?? `OnlyOffice error ${e.data?.errorCode ?? ""}`;
            },
          },
        };
        // Make sure the customization carries the live theme value, not the
        // (possibly stale) value baked in by the server load.
        cfg.editorConfig = {
          ...cfg.editorConfig,
          customization: {
            ...(cfg.editorConfig?.customization ?? {}),
            uiTheme: ooThemeId(theme.effective),
          },
        };
        // @ts-expect-error - DocsAPI is injected by the api.js
        editor = new DocsAPI.DocEditor("oo-placeholder", cfg);
        // Debug hook so a force-save can be triggered from the devtools console.
        (window as unknown as { __ooEditor?: typeof editor }).__ooEditor = editor;
      } catch (e) {
        status = "error";
        errorMsg = (e as Error).message;
      }
    };
    script.onerror = () => {
      status = "error";
      errorMsg = `Konnte OnlyOffice-API nicht laden (${data.apiJsUrl}). Läuft der DocumentServer?`;
    };
    document.head.appendChild(script);

    return () => {
      try { editor?.destroyEditor?.(); } catch {}
    };
  });

  // Live theme sync — when the user toggles light/dark/system in our app,
  // tell the OnlyOffice editor to re-render with the matching palette.
  $effect(() => {
    const eff = theme.effective;
    if (status === "ready") {
      try { editor?.setTheme?.(ooThemeId(eff)); } catch { /* ignore */ }
    }
  });

  function back() {
    const u = new URL("/files", window.location.origin);
    if (data.group) u.searchParams.set("group", data.group);
    if (data.file.parent_id) u.searchParams.set("folder", data.file.parent_id);
    goto(u.pathname + u.search);
  }
</script>

<div class="grid h-full" style="grid-template-rows: auto 1fr">
  <header class="flex items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-950/80 px-6 py-2.5">
    <div class="flex items-center gap-2 min-w-0">
      <button
        onclick={back}
        class="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
      >
        <Icon name="chevron-left" size={16} /> Dateien
      </button>
      <span class="truncate text-sm font-medium">{data.file.name}</span>
      {#if data.mode === "view"}
        <span class="rounded-full border border-zinc-700 px-2 py-0.5 text-[11px] uppercase tracking-wide text-zinc-400">nur lesen</span>
      {/if}
    </div>
    <div class="flex items-center gap-2 text-xs text-zinc-500">
      {#if status === "loading"}
        <span class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-600 border-t-indigo-400"></span>
        OnlyOffice startet…
      {:else if status === "ready"}
        <span class="h-2 w-2 rounded-full bg-emerald-400"></span>
        Verbunden
      {:else}
        <span class="h-2 w-2 rounded-full bg-red-400"></span>
        Fehler
      {/if}
    </div>
  </header>

  <section class="relative h-full">
    {#if status === "error"}
      <div class="grid h-full place-items-center px-8 text-center text-sm text-zinc-400">
        <div class="max-w-md">
          <div class="mx-auto mb-3 inline-grid h-12 w-12 place-items-center rounded-2xl bg-red-500/10 text-red-300">
            <Icon name="x" size={28} />
          </div>
          <p class="font-medium text-zinc-200">OnlyOffice nicht erreichbar</p>
          {#if errorMsg}<p class="mt-2 text-xs text-zinc-500">{errorMsg}</p>{/if}
        </div>
      </div>
    {/if}
    <div id="oo-placeholder" bind:this={placeholder} class="h-full w-full"></div>
  </section>
</div>
