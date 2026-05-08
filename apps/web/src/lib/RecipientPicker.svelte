<script lang="ts">
  /**
   * Minimal autocomplete recipient input: backed by a comma-separated string
   * (so it slots into the existing `to`/`cc`/`bcc` fields without changing
   * the API shape). Suggestions are pulled from /api/contacts and matched
   * against the current trailing fragment.
   */
  interface Contact { login: string; name_hr: string; online: boolean; groups: string[] }

  let { value = $bindable(""), placeholder = "" }: { value: string; placeholder?: string } = $props();

  let contacts = $state<Contact[]>([]);
  let loaded = $state(false);
  let focused = $state(false);
  let highlight = $state(0);

  async function ensureLoaded() {
    if (loaded) return;
    loaded = true;
    try {
      const r = await fetch("/api/contacts");
      const j = await r.json();
      contacts = j.contacts ?? [];
    } catch { /* offline / unauth */ }
  }

  // Split into already-confirmed tokens + the active fragment being typed.
  const parts = $derived.by(() => {
    const idx = value.lastIndexOf(",");
    return idx < 0
      ? { prefix: "", frag: value }
      : { prefix: value.slice(0, idx + 1), frag: value.slice(idx + 1) };
  });
  const fragTrimmed = $derived(parts.frag.trim().toLowerCase());

  const suggestions = $derived.by(() => {
    if (!focused || fragTrimmed.length < 2) return [] as Contact[];
    return contacts
      .filter((c) =>
        c.login.toLowerCase().includes(fragTrimmed) ||
        c.name_hr.toLowerCase().includes(fragTrimmed),
      )
      .slice(0, 8);
  });
  // Clamp the keyboard cursor whenever the suggestion list shrinks so Enter
  // can't dereference an out-of-range index.
  $effect(() => {
    if (highlight >= suggestions.length) highlight = 0;
  });

  function pick(c: Contact | undefined) {
    if (!c) return;
    const join = parts.prefix && !parts.prefix.endsWith(" ") ? " " : "";
    value = `${parts.prefix}${join}${c.login}, `;
    highlight = 0;
  }

  function onkeydown(e: KeyboardEvent) {
    if (!suggestions.length) return;
    if (e.key === "ArrowDown") { highlight = (highlight + 1) % suggestions.length; e.preventDefault(); }
    else if (e.key === "ArrowUp") { highlight = (highlight - 1 + suggestions.length) % suggestions.length; e.preventDefault(); }
    else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      pick(suggestions[highlight]);
    }
  }
</script>

<div class="relative flex-1">
  <input
    type="text"
    bind:value
    {placeholder}
    onfocus={() => { focused = true; ensureLoaded(); }}
    onblur={() => setTimeout(() => (focused = false), 150)}
    {onkeydown}
    class="w-full bg-transparent outline-none placeholder:text-zinc-600"
  />
  {#if suggestions.length}
    <ul class="absolute left-0 top-full z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border border-zinc-800 bg-zinc-950 py-1 shadow-lg">
      {#each suggestions as s, i}
        <li>
          <button
            type="button"
            onmousedown={(e) => { e.preventDefault(); pick(s); }}
            class="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm {i === highlight ? 'bg-zinc-800' : 'hover:bg-zinc-900'}"
          >
            <span class="min-w-0 flex-1 truncate">
              <span class="font-medium">{s.name_hr}</span>
              <span class="ml-1 text-xs text-zinc-500">&lt;{s.login}&gt;</span>
            </span>
            {#if s.online}<span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>{/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>
