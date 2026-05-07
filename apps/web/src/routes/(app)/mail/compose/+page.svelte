<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { composeStore } from "$lib/composeStore.svelte";
  let { data } = $props();

  onMount(() => {
    if (data.prefill) composeStore.openWith(data.prefill);
    else composeStore.openNew();
    goto("/mail", { replaceState: true });
  });
</script>

<div class="grid h-full place-items-center text-sm text-zinc-500">
  Öffne Editor…
</div>
