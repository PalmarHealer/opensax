<script lang="ts">
  import type { Snippet } from "svelte";
  import { enhance } from "$app/forms";
  import Modal from "$lib/Modal.svelte";

  /**
   * Bestätigung für eine destruktive Aktion — statt `window.confirm()`.
   *
   * Mit `action` enthält der Dialog das Formular selbst: `fields` landen als
   * versteckte Felder darin, „Bestätigen“ schickt es an `action`. Fehler zeigt
   * er an, statt sich zu schließen; eine Weiterleitung der Action (z. B. nach
   * dem Löschen eines Themas) übernimmt `update()`.
   *
   * Ohne Form-Action (Aufruf per `fetch`) stattdessen `onconfirm` übergeben:
   * gibt es einen Text zurück, wird der als Fehler gezeigt, sonst schließt der
   * Dialog.
   */
  interface Props {
    open: boolean;
    onclose: () => void;
    title: string;
    action?: string;
    fields?: Record<string, string>;
    onconfirm?: () => Promise<string | void>;
    confirmLabel?: string;
    children: Snippet;
  }
  let { open, onclose, title, action, fields = {}, onconfirm, confirmLabel = "Löschen", children }: Props = $props();

  let busy = $state(false);
  let error = $state<string | null>(null);
  $effect(() => {
    if (open) error = null;
  });

  async function confirmViaCallback(e: SubmitEvent) {
    e.preventDefault();
    if (!onconfirm) return;
    busy = true;
    error = null;
    try {
      const failure = await onconfirm();
      if (failure) error = failure;
      else onclose();
    } catch (err) {
      error = (err as Error)?.message || "Aktion fehlgeschlagen.";
    } finally {
      busy = false;
    }
  }
</script>

{#snippet body()}
  <div class="text-sm text-zinc-300">{@render children()}</div>
  {#if error}
    <p class="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>
  {/if}
  <div class="flex justify-end gap-2">
    <button type="button" disabled={busy} onclick={onclose} class="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-100 disabled:opacity-50">Abbrechen</button>
    <button type="submit" disabled={busy} class="rounded-md bg-red-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-400 disabled:opacity-60">
      {busy ? "Bitte warten…" : confirmLabel}
    </button>
  </div>
{/snippet}

<Modal {open} onclose={() => { if (!busy) onclose(); }} {title}>
  {#if onconfirm}
    <form onsubmit={confirmViaCallback} class="space-y-4">
      {@render body()}
    </form>
  {:else}
    <form
      method="POST"
      {action}
      use:enhance={() => {
        busy = true;
        error = null;
        return async ({ result, update }) => {
          busy = false;
          if (result.type === "failure") {
            error = (result.data?.error as string | undefined) ?? "Aktion fehlgeschlagen.";
            return;
          }
          onclose();
          await update();
        };
      }}
      class="space-y-4"
    >
      {#each Object.entries(fields) as [name, value]}
        <input type="hidden" {name} {value} />
      {/each}
      {@render body()}
    </form>
  {/if}
</Modal>
