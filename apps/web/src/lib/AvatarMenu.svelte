<script lang="ts">
  import Icon from "$lib/Icon.svelte";
  import { avatarColor, initials } from "$lib/avatar";
  import { theme } from "$lib/themeStore.svelte";

  interface Props {
    displayName?: string;
    email?: string;
    /** Stable seed (login). Falls back to email. */
    seed?: string;
    size?: number;
    /** Direction the menu opens. */
    placement?: "bottom-right" | "bottom-left" | "top-right" | "top-left" | "right-bottom";
  }
  let { displayName = "", email = "", seed = "", size = 36, placement = "bottom-right" }: Props = $props();

  const initialsText = $derived(initials(displayName, email));
  const colors = $derived(avatarColor(seed || email || displayName));

  let open = $state(false);
  let root: HTMLDivElement;

  $effect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!root.contains(e.target as Node)) open = false;
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") open = false; };
    document.addEventListener("mousedown", onDoc, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc, true);
      document.removeEventListener("keydown", onKey);
    };
  });

  async function logout() {
    open = false;
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }
</script>

<div class="relative" bind:this={root}>
  <button
    type="button"
    onclick={() => (open = !open)}
    class="grid place-items-center rounded-full font-semibold transition hover:opacity-80"
    style="width: {size}px; height: {size}px; background: {colors.bg}; color: {colors.fg};"
    aria-haspopup="menu"
    aria-expanded={open}
    title={displayName || email}
  >
    <span style="font-size: {Math.round(size * 0.4)}px">{initialsText}</span>
  </button>

  {#if open}
    {@const placementClass = {
      "bottom-right": "right-0 top-full mt-4",
      "bottom-left":  "left-0 top-full mt-4",
      "top-right":    "right-0 bottom-full mb-4",
      "top-left":     "left-0 bottom-full mb-4",
      "right-bottom": "left-full bottom-0 ml-5",
    }[placement]}
    <div role="menu" class="absolute z-30 w-60 max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl {placementClass}">
      <div class="flex items-center gap-3 border-b border-zinc-800 px-3 py-3">
        <div
          class="grid h-10 w-10 place-items-center rounded-full text-sm font-semibold"
          style="background: {colors.bg}; color: {colors.fg};"
        >{initialsText}</div>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium">{displayName || "—"}</p>
          <p class="truncate text-xs text-zinc-500">{email}</p>
        </div>
      </div>
      <!-- Theme toggle: Light / Dark / System -->
      <div class="flex items-center justify-between gap-2 border-b border-zinc-800 px-3 py-2.5">
        <span class="text-xs text-zinc-500">Erscheinungsbild</span>
        <div class="flex items-center gap-0.5 rounded-full border border-zinc-800 bg-zinc-900 p-0.5">
          {#each [["light","sun","Hell"],["dark","moon","Dunkel"],["system","device-desktop","System"]] as [val, icon, label]}
            <button
              type="button"
              onclick={() => theme.set(val as "light" | "dark" | "system")}
              title={label}
              aria-label={label}
              aria-pressed={theme.pref === val}
              class="grid h-7 w-7 place-items-center rounded-full transition
                {theme.pref === val ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}"
            >
              <Icon name={icon} size={14} />
            </button>
          {/each}
        </div>
      </div>

      <div class="p-1">
        <a
          href="/settings"
          onclick={() => (open = false)}
          class="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-900"
        >
          <Icon name="settings" size={16} /> Einstellungen
        </a>
        <button
          onclick={logout}
          class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-red-300 hover:bg-zinc-900"
        >
          <Icon name="logout" size={16} /> Abmelden
        </button>
      </div>
    </div>
  {/if}
</div>
