<script lang="ts">
  import { goto } from "$app/navigation";
  import Icon from "$lib/Icon.svelte";
  import { composeStore } from "$lib/composeStore.svelte";

  let { name, login, compact = false }: { name?: string; login?: string; compact?: boolean } = $props();

  let open = $state(false);
  let anchor: HTMLButtonElement;
  let popoverStyle = $state("");

  let profile = $state<Record<string, unknown> | null>(null);
  let loading = $state(false);

  const display = $derived(name?.trim() || login || "—");
  // Messenger only routes between LernSax accounts; external mail addrs
  // can't be chat partners.
  const canChat = $derived(!!login && /\.lernsax\.de$/i.test(login));

  async function loadProfile() {
    if (!login || profile || loading) return;
    loading = true;
    try {
      const r = await fetch(`/api/profile/${encodeURIComponent(login)}`);
      if (r.ok) {
        const j = await r.json();
        profile = j.profile ?? null;
      }
    } finally { loading = false; }
  }

  const POPOVER_W = 288; // matches w-72
  const MARGIN = 8;
  function show() {
    if (!login) return;
    const rect = anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const overflow = rect.left + POPOVER_W + MARGIN - vw;
    const left = overflow > 0
      ? Math.max(MARGIN, rect.right - POPOVER_W)
      : rect.left;
    popoverStyle = `top: ${rect.bottom + 4}px; left: ${left}px;`;
    open = true;
    loadProfile();
  }

  function hide() { open = false; }

  function mailTo() {
    if (!login) return;
    composeStore.openWith({ to: login });
    hide();
  }
  function chatWith() {
    if (!login) return;
    goto(`/messenger?with=${encodeURIComponent(login)}`);
    hide();
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Escape") hide();
  }
</script>

<svelte:window onkeydown={onkeydown} />

<button
  bind:this={anchor}
  type="button"
  onclick={show}
  class="inline cursor-pointer rounded text-left {compact ? '' : 'hover:underline'} {login ? '' : 'pointer-events-none'}"
>{display}</button>

{#if open}
  <div class="fixed inset-0 z-40" onclick={hide} role="presentation"></div>
  <div
    class="fixed z-50 w-72 cursor-default rounded-xl border border-zinc-800 bg-zinc-950 p-4 shadow-2xl"
    style={popoverStyle}
    role="dialog"
  >
    <div class="mb-3 flex items-center gap-3">
      <div class="grid h-10 w-10 place-items-center rounded-full bg-zinc-800 text-sm font-medium">
        {(name ?? login ?? "?").slice(0, 1).toUpperCase()}
      </div>
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-semibold">{display}</p>
        <p class="truncate text-xs text-zinc-500">{login}</p>
      </div>
    </div>

    {#if profile}
      <dl class="mb-3 space-y-1 text-xs text-zinc-400">
        {#if profile.position}<div><dt class="inline text-zinc-500">Position: </dt><dd class="inline text-zinc-300">{profile.position}</dd></div>{/if}
        {#if profile.department}<div><dt class="inline text-zinc-500">Bereich: </dt><dd class="inline text-zinc-300">{profile.department}</dd></div>{/if}
        {#if profile.phone}<div><dt class="inline text-zinc-500">Telefon: </dt><dd class="inline text-zinc-300">{profile.phone}</dd></div>{/if}
      </dl>
    {/if}

    <div class="flex flex-col gap-1">
      <button onclick={mailTo} class="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-zinc-900">
        <span class="shrink-0"><Icon name="mail" size={14} /></span>
        <span class="min-w-0 flex-1 truncate">Mail an {display}</span>
      </button>
      {#if canChat}
        <button onclick={chatWith} class="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-zinc-900">
          <span class="shrink-0"><Icon name="message-circle" size={14} /></span>
          <span>Chat starten</span>
        </button>
      {/if}
    </div>
  </div>
{/if}
