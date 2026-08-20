<script lang="ts">
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import Icon from "$lib/Icon.svelte";
  import ComposeWindow from "$lib/ComposeWindow.svelte";
  import AvatarMenu from "$lib/AvatarMenu.svelte";
  import { NAV_TABS, loadNavConfig, scopesFor, groupScope, tabById, type NavConfig } from "$lib/nav";
  import { theme } from "$lib/themeStore.svelte";
  import { media } from "$lib/mediaQuery.svelte";

  let { data, children } = $props();

  let navConfig = $state<NavConfig>({
    visible: NAV_TABS.filter((t) => t.id !== "home").map((t) => t.id),
    hidden: [],
    mode: "sidenav",
  });
  $effect(() => {
    theme.init();
    navConfig = loadNavConfig();
    // Listen for changes from settings (same-tab updates won't fire 'storage' but cross-tab will).
    const onStorage = (e: StorageEvent) => {
      if (e.key === "lernsax.nav.v2") navConfig = loadNavConfig();
    };
    const onCustom = () => { navConfig = loadNavConfig(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener("lernsax:nav-changed", onCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("lernsax:nav-changed", onCustom);
    };
  });

  const visibleTabs = $derived(
    navConfig.visible
      .map((id) => tabById(id))
      .filter((t): t is NonNullable<ReturnType<typeof tabById>> => !!t),
  );

  function isActive(href: string): boolean {
    if (href === "/") return page.url.pathname === "/";
    return page.url.pathname.startsWith(href);
  }

  const scopes = $derived(scopesFor(page.url.pathname));
  const showPersonal = $derived(scopes ? scopes.includes("personal") : true);
  const showGroupSection = $derived(scopes ? scopes.some((s) => s !== "personal") : true);
  const filteredGroups = $derived.by(() => {
    if (!scopes) return data.groups;
    const allow = new Set(scopes);
    return data.groups.filter((g) => allow.has(groupScope(g)));
  });
  const showSidebar = $derived(showGroupSection && filteredGroups.length > 0);

  const currentGroup = $derived(page.url.searchParams.get("group"));

  // Mobile drawer (sidenav mode). Closes automatically on navigation.
  let drawerOpen = $state(false);
  $effect(() => {
    void page.url.pathname;
    void page.url.search;
    drawerOpen = false;
  });

  function selectGroup(login: string | null) {
    const u = new URL(page.url);
    if (login) u.searchParams.set("group", login);
    else u.searchParams.delete("group");
    // Drop identifiers that only make sense inside the previous group —
    // mail folder, calendar month, file id, file edit mode, forum thread,
    // wiki page, messenger peer.
    for (const k of ["folder", "ym", "id", "mode", "thread", "page", "with"]) {
      u.searchParams.delete(k);
    }
    // /files/edit, /mail/[folder]/[message] etc. all point at a specific
    // record from the old group — bounce up to the section root.
    let path = u.pathname;
    if (path.startsWith("/files/")) path = "/files";
    else if (path.startsWith("/mail/")) path = "/mail";
    goto(path + u.search, { invalidateAll: true });
  }
</script>

<!-- ─── Reusable bits ──────────────────────────────────────────────────── -->
{#snippet groupRail()}
  <p class="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-zinc-500">Gruppen / Räume</p>
  {#if showPersonal}
    <button
      class="mb-1 flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition
        {currentGroup === null ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-900'}"
      onclick={() => selectGroup(null)}
    ><span class="truncate">Persönlich</span></button>
  {/if}
  {#each filteredGroups as g}
    <button
      class="block w-full truncate rounded-md px-2 py-1.5 text-left text-sm transition
        {currentGroup === g.login ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-900'}"
      onclick={() => selectGroup(g.login)}
      title={`${g.name}\n${g.login}`}
    >{g.name}</button>
  {/each}
{/snippet}

{#if media.mobile}
  <!-- ════ Mobile ════════════════════════════════════════════════════════ -->
  {#if navConfig.mode === "topnav"}
    <!-- Bottom tab bar -->
    <div class="flex h-full flex-col">
      <header class="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-950 px-3 py-2">
        <a href="/" class="flex items-center gap-2">
          <span class="grid h-8 w-8 place-items-center rounded-xl bg-indigo-500/10 text-indigo-300">
            <Icon name="home" size={16} />
          </span>
          <span class="text-sm font-semibold tracking-tight">OpenSax</span>
        </a>
        <AvatarMenu displayName={data.displayName} email={data.email} seed={data.user?.login ?? data.email} size={32} placement="bottom-right" />
      </header>

      {#if showSidebar}
        <div class="flex shrink-0 gap-1 overflow-x-auto border-b border-zinc-800 bg-zinc-900/40 px-2 py-2">
          {#if showPersonal}
            <button
              class="shrink-0 rounded-full px-3 py-1 text-xs transition
                {currentGroup === null ? 'bg-zinc-800 text-zinc-100' : 'bg-zinc-900 text-zinc-300'}"
              onclick={() => selectGroup(null)}
            >Persönlich</button>
          {/if}
          {#each filteredGroups as g}
            <button
              class="shrink-0 max-w-[60vw] truncate rounded-full px-3 py-1 text-xs transition
                {currentGroup === g.login ? 'bg-zinc-800 text-zinc-100' : 'bg-zinc-900 text-zinc-300'}"
              onclick={() => selectGroup(g.login)}
              title={g.name}
            >{g.name}</button>
          {/each}
        </div>
      {/if}

      <main class="min-h-0 flex-1 overflow-auto">
        {@render children()}
      </main>

      <nav class="flex shrink-0 items-stretch gap-0.5 overflow-x-auto border-t border-zinc-800 bg-zinc-950 px-1 py-1
        pb-[max(0.25rem,env(safe-area-inset-bottom))]">
        <a href="/" class="flex min-w-[3.75rem] flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[10px] transition
          {page.url.pathname === '/' ? 'text-indigo-300' : 'text-zinc-400'}">
          <Icon name="home" size={20} />
          <span class="truncate">Start</span>
        </a>
        {#each visibleTabs as item}
          <a
            href={item.href}
            class="flex min-w-[3.75rem] flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[10px] transition
              {isActive(item.href) ? 'text-indigo-300' : 'text-zinc-400'}"
          >
            <Icon name={item.icon} size={20} />
            <span class="w-full truncate text-center">{item.label}</span>
          </a>
        {/each}
      </nav>
    </div>
  {:else}
    <!-- Hamburger drawer -->
    <div class="flex h-full flex-col">
      <header class="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-950 px-3 py-2">
        <div class="flex items-center gap-2">
          <button
            onclick={() => (drawerOpen = true)}
            class="grid h-9 w-9 place-items-center rounded-lg text-zinc-300 hover:bg-zinc-900"
            aria-label="Menü öffnen"
          ><Icon name="menu" size={20} /></button>
          <a href="/" class="flex items-center gap-2">
            <span class="grid h-8 w-8 place-items-center rounded-xl bg-indigo-500/10 text-indigo-300">
              <Icon name="home" size={16} />
            </span>
            <span class="text-sm font-semibold tracking-tight">OpenSax</span>
          </a>
        </div>
        <AvatarMenu displayName={data.displayName} email={data.email} seed={data.user?.login ?? data.email} size={32} placement="bottom-right" />
      </header>

      <main class="min-h-0 flex-1 overflow-auto">
        {@render children()}
      </main>
    </div>

    {#if drawerOpen}
      <div
        class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        onclick={(e) => { if (e.currentTarget === e.target) drawerOpen = false; }}
        role="presentation"
      >
        <aside class="flex h-full w-72 max-w-[85vw] flex-col border-r border-zinc-800 bg-zinc-950">
          <div class="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
            <span class="text-sm font-semibold tracking-tight">OpenSax</span>
            <button
              onclick={() => (drawerOpen = false)}
              class="grid h-8 w-8 place-items-center rounded-md text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
              aria-label="Menü schließen"
            ><Icon name="x" size={18} /></button>
          </div>
          <nav class="min-h-0 flex-1 overflow-auto p-2">
            <a
              href="/"
              class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition
                {page.url.pathname === '/' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-900'}"
            >
              <Icon name="home" size={18} /> Übersicht
            </a>
            {#each visibleTabs as item}
              <a
                href={item.href}
                class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition
                  {isActive(item.href) ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-900'}"
              >
                <Icon name={item.icon} size={18} /> {item.label}
              </a>
            {/each}

            {#if showSidebar}
              <div class="my-3 h-px bg-zinc-800"></div>
              {@render groupRail()}
            {/if}
          </nav>
        </aside>
      </div>
    {/if}
  {/if}
{:else if navConfig.mode === "topnav"}
  <!-- ─── Top navigation layout ────────────────────────────────────────── -->
  <div class="grid h-full" style="grid-template-rows: auto 1fr; grid-template-columns: {showSidebar ? '240px 1fr' : '1fr'};">
    <header class="col-span-full flex items-center justify-between gap-4 border-b border-zinc-800 bg-zinc-950 px-4 py-2">
      <a href="/" class="flex shrink-0 items-center gap-2 rounded-md px-1 py-1 hover:bg-zinc-900">
        <span class="grid h-9 w-9 place-items-center rounded-xl bg-indigo-500/10 text-indigo-300">
          <Icon name="home" size={18} />
        </span>
        <span class="text-sm font-semibold tracking-tight">OpenSax</span>
      </a>
      <nav class="flex flex-1 items-center gap-0.5 overflow-x-auto">
        {#each visibleTabs as item}
          <a
            href={item.href}
            class="flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm transition
              {isActive(item.href) ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'}"
          >
            <Icon name={item.icon} size={16} />
            {item.label}
          </a>
        {/each}
      </nav>
      <AvatarMenu displayName={data.displayName} email={data.email} seed={data.user?.login ?? data.email} placement="bottom-right" />
    </header>

    {#if showSidebar}
      <aside class="row-start-2 flex h-full min-w-0 flex-col border-r border-zinc-800 bg-zinc-900/40">
        <div class="min-w-0 px-3 py-3">
          {@render groupRail()}
        </div>
      </aside>
    {/if}

    <main class="row-start-2 h-full min-w-0 overflow-auto">
      {@render children()}
    </main>
  </div>
{:else}
  <!-- ─── Side navigation layout (default) ─────────────────────────────── -->
  <div class="grid h-full" style="grid-template-columns: {showSidebar ? '64px 240px 1fr' : '64px 1fr'}">
    <nav class="flex h-full w-16 flex-col items-center gap-1 border-r border-zinc-800 bg-zinc-950 py-3">
      <a href="/" class="grid h-10 w-10 place-items-center rounded-xl bg-indigo-500/10 text-indigo-300" title="Übersicht">
        <Icon name="home" size={20} />
      </a>
      <div class="my-1 h-px w-8 bg-zinc-800"></div>
      {#each visibleTabs as item}
        <a
          href={item.href}
          title={item.label}
          class="group relative grid h-10 w-10 place-items-center rounded-xl transition
            {isActive(item.href) ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'}"
        >
          <Icon name={item.icon} size={20} />
          {#if isActive(item.href)}
            <span class="absolute -left-2 top-2 bottom-2 w-1 rounded-full bg-indigo-400"></span>
          {/if}
        </a>
      {/each}
      <div class="flex-1"></div>
      <AvatarMenu displayName={data.displayName} email={data.email} seed={data.user?.login ?? data.email} size={40} placement="right-bottom" />
    </nav>

    {#if showSidebar}
      <aside class="flex h-full min-w-0 flex-col border-r border-zinc-800 bg-zinc-900/40">
        <div class="min-w-0 px-3 py-3">
          {@render groupRail()}
        </div>
      </aside>
    {/if}

    <main class="h-full min-w-0 overflow-auto">
      {@render children()}
    </main>
  </div>
{/if}

<ComposeWindow />
