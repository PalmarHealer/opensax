<script lang="ts">
  import StubSection from "$lib/StubSection.svelte";
  let { data } = $props();
</script>

{#if !data.group}
  <div class="mx-auto max-w-3xl px-8 py-8">
    <h1 class="text-2xl font-semibold">Forum</h1>
    <p class="mt-2 text-sm text-zinc-400">Gruppe als <code>?group=…</code> wählen.</p>
  </div>
{:else}
  <StubSection title="Forum — {data.group}" data={data.entries} />
{/if}
