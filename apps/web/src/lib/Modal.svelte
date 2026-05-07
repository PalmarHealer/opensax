<script lang="ts">
  import type { Snippet } from "svelte";
  interface Props {
    open: boolean;
    onclose?: () => void;
    title?: string;
    children: Snippet;
    footer?: Snippet;
    width?: string;
  }
  let { open, onclose, title, children, footer, width = "max-w-md" }: Props = $props();

  $effect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onclose?.(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  });
</script>

{#if open}
  <div
    class="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4"
    onclick={(e) => { if (e.currentTarget === e.target) onclose?.(); }}
    role="presentation"
  >
    <div class="w-full {width} rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl">
      {#if title}
        <header class="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
          <h2 class="text-base font-semibold">{title}</h2>
          <button onclick={onclose} class="rounded-md p-1 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200" aria-label="Schließen">✕</button>
        </header>
      {/if}
      <div class="px-5 py-4">{@render children()}</div>
      {#if footer}
        <footer class="flex justify-end gap-2 border-t border-zinc-800 px-5 py-3">{@render footer()}</footer>
      {/if}
    </div>
  </div>
{/if}
