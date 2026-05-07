<script lang="ts">
  import { onMount } from "svelte";
  import Icon from "./Icon.svelte";
  let url = $state("");
  let copied = $state(false);
  onMount(() => {
    // MCP shares the web app's hostname under /mcp.
    url = `${location.origin.replace(/^https?:\/\/(www\.)?/, "https://")}/mcp`;
  });
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch { /* noop */ }
  }
</script>

<div class="flex items-stretch gap-2">
  <code class="flex-1 truncate rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs">{url || "—"}</code>
  <button onclick={copy} class="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-medium hover:bg-zinc-800">
    {copied ? "Kopiert" : "Kopieren"}
  </button>
</div>
