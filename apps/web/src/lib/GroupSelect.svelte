<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  interface Group { login: string; name: string }
  interface Props {
    /** preserve other query params; only updates `group` */
    paramName?: string;
    /** when changing groups, also clear these other params (e.g. "folder") */
    clearParams?: string[];
    /** include a "Persönlich" option */
    includePersonal?: boolean;
  }
  let { paramName = "group", clearParams = [], includePersonal = true }: Props = $props();
  const groups = $derived((page.data.groups as Group[]) ?? []);
  const current = $derived(page.url.searchParams.get(paramName));

  function navTo(value: string | null) {
    const u = new URL(page.url);
    if (value) u.searchParams.set(paramName, value);
    else u.searchParams.delete(paramName);
    for (const p of clearParams) u.searchParams.delete(p);
    goto(u.pathname + u.search, { invalidateAll: true });
  }
</script>

<select
  class="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm max-w-[14rem] truncate"
  onchange={(e) => navTo((e.currentTarget as HTMLSelectElement).value || null)}
>
  {#if includePersonal}
    <option value="" selected={!current}>Persönlich</option>
  {/if}
  {#each groups as g}
    <option value={g.login} selected={current === g.login}>{g.name}</option>
  {/each}
</select>
