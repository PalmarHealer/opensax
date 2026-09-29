<script lang="ts">
  import type { Snippet } from "svelte";
  import { enhance } from "$app/forms";
  import Modal from "$lib/Modal.svelte";

  /**
   * Bestätigung für eine destruktive Form-Action — statt `window.confirm()`.
   *
   * Der Dialog enthält das Formular selbst: `fields` landen als versteckte
   * Felder darin, „Bestätigen“ schickt es an `action`. Fehler zeigt er an, statt
   * sich zu schließen; eine Weiterleitung der Action (z. B. nach dem Löschen
   * eines Themas) übernimmt `update()`.
   */
  interface Props {
    open: boolean;
    onclose: () => void;
    title: string;
    action: string;
    fields?: Record<string, string>;
    confirmLabel?: string;
    children: Snippet;
  }
  let { open, onclose, title, action, fields = {}, confirmLabel = "Löschen", children }: Props = $props();

  let busy = $state(false);
  let error = $state<string | null>(null);
  $effect(() => {
    if (open) error = null;
  });
</script>

<Modal {open} onclose={() => { if (!busy) onclose(); }} {title}>
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
  </form>
</Modal>
