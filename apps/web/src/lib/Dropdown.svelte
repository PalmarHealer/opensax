<script lang="ts">
  import type { Snippet } from "svelte";
  interface Props {
    align?: "left" | "right";
    label?: Snippet;
    children: Snippet<[() => void]>;
    buttonClass?: string;
  }
  let { align = "right", label, children, buttonClass = "" }: Props = $props();
  let open = $state(false);
  let root: HTMLDivElement;

  $effect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!root.contains(e.target as Node)) open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") open = false;
    };
    document.addEventListener("mousedown", onDoc, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc, true);
      document.removeEventListener("keydown", onKey);
    };
  });
</script>

<div class="relative inline-block" bind:this={root}>
  <button
    type="button"
    class={buttonClass}
    onclick={() => (open = !open)}
    aria-haspopup="menu"
    aria-expanded={open}
  >{@render label?.()}</button>

  {#if open}
    <div
      role="menu"
      class="absolute z-30 mt-1 w-44 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 p-1 shadow-xl
        {align === 'right' ? 'right-0' : 'left-0'}"
    >
      {@render children(() => (open = false))}
    </div>
  {/if}
</div>
