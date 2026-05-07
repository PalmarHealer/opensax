<script lang="ts">
  let { title, data, hint }: { title: string; data: unknown; hint?: string } = $props();
</script>

<div class="mx-auto max-w-5xl px-8 py-8">
  <header class="mb-6">
    <h1 class="text-2xl font-semibold tracking-tight">{title}</h1>
    {#if hint}<p class="mt-1 text-sm text-zinc-400">{hint}</p>{/if}
  </header>
  <div class="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
    <p class="mb-3 text-xs uppercase tracking-wide text-zinc-500">Live-Daten (Pre-UI)</p>
    <pre class="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-950 p-4 text-xs leading-relaxed text-zinc-300">{JSON.stringify(data, null, 2)}</pre>
  </div>
</div>
