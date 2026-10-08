<script lang="ts">
  import type { Snippet } from "svelte";
  import { enhance } from "$app/forms";
  import Modal from "$lib/Modal.svelte";

  /**
   * Bestätigung für eine Aktion — statt `window.confirm()`. Standardmäßig
   * destruktiv (roter Knopf); `tone="primary"` für Rückfragen ohne Datenverlust.
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
    cancelLabel?: string;
    tone?: "danger" | "primary";
    children: Snippet;
  }
  let {
    open, onclose, title, action, fields = {}, onconfirm,
    confirmLabel = "Löschen", cancelLabel = "Abbrechen", tone = "danger", children,
  }: Props = $props();

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
    <button type="button" disabled={busy} onclick={onclose} class="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-100 disabled:opacity-50">{cancelLabel}</button>
    <button
      type="submit"
      disabled={busy}
      class="rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60
        {tone === 'danger' ? 'bg-red-500 hover:bg-red-400' : 'bg-indigo-500 hover:bg-indigo-400'}"
    >
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
