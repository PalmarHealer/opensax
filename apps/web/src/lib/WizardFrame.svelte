<script lang="ts">
  import type { Snippet } from "svelte";
  import { fade, fly } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import Icon from "$lib/Icon.svelte";
  import { motion } from "$lib/motion";

  /**
   * Gemeinsamer Rahmen für Schritt-für-Schritt-Dialoge (Feedback, Onboarding):
   * Overlay, Kopf mit Titel und Fortschrittsbalken, scrollbarer Inhalt,
   * Fußleiste. Auf dem Handy bildschirmfüllend.
   *
   * Steht auf `data-feedback-ignore`, damit ein Feedback-Screenshot den Dialog
   * nicht mit aufnimmt.
   */
  interface Props {
    title: string;
    /** Kleines Etikett vor dem Titel, z. B. die Art der Meldung. */
    badge?: string | null;
    stepCount?: number;
    stepIndex?: number;
    /** Schließen-Knopf oben rechts; ohne Callback gibt es keinen. */
    onclose?: () => void;
    closeLabel?: string;
    /** Leiste zwischen Kopf und Inhalt, z. B. „Eingaben verwerfen?“. */
    banner?: Snippet;
    children: Snippet;
    footer?: Snippet;
    /** Wird nach jedem Schrittwechsel nach oben gescrollt. */
    scrollKey?: unknown;
  }
  let {
    title, badge = null, stepCount = 0, stepIndex = 0, onclose, closeLabel = "Schließen",
    banner, children, footer, scrollKey,
  }: Props = $props();

  let body = $state<HTMLDivElement | null>(null);
  $effect(() => {
    scrollKey;
    body?.scrollTo(0, 0);
  });

  $effect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  });
</script>

<div data-feedback-ignore class="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm sm:p-4" role="presentation" transition:fade={{ duration: motion(180) }}>
  <div
    in:fly={{ y: 16, duration: motion(320), easing: cubicOut }}
    role="dialog"
    aria-modal="true"
    aria-labelledby="wizard-title"
    class="flex h-[100dvh] w-full flex-col overflow-hidden border-zinc-800 bg-zinc-950 shadow-2xl sm:h-auto sm:max-h-[90vh] sm:max-w-xl sm:rounded-2xl sm:border"
  >
    <header class="border-b border-zinc-800 px-5 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] sm:pt-3">
      <div class="flex items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-2">
          {#if badge}
            <span class="shrink-0 rounded-full bg-indigo-500/10 px-2 py-0.5 text-xs text-indigo-300">{badge}</span>
          {/if}
          <h2 id="wizard-title" class="truncate text-base font-semibold">{title}</h2>
        </div>
        {#if onclose}
          <button onclick={onclose} class="rounded-md p-1 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200" aria-label={closeLabel} title={closeLabel}>
            <Icon name="x" size={18} />
          </button>
        {/if}
      </div>
      {#if stepCount > 1}
        <div class="mt-3 flex gap-1" aria-label="Schritt {stepIndex + 1} von {stepCount}">
          {#each { length: stepCount } as _, i}
            <span class="h-1 flex-1 overflow-hidden rounded-full bg-zinc-800">
              <span class="block h-full rounded-full bg-indigo-500 transition-[width] duration-500 ease-out motion-reduce:transition-none" style="width: {i <= stepIndex ? 100 : 0}%"></span>
            </span>
          {/each}
        </div>
      {/if}
    </header>

    {@render banner?.()}

    <div bind:this={body} class="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-5 py-4">
      {@render children()}
    </div>

    {#if footer}
      <footer class="flex items-center justify-between gap-2 border-t border-zinc-800 px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pb-3">
        {@render footer()}
      </footer>
    {/if}
  </div>
</div>
