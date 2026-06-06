<script lang="ts">
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import Icon from "$lib/Icon.svelte";
  import ComposeWindow from "$lib/ComposeWindow.svelte";
  import AvatarMenu from "$lib/AvatarMenu.svelte";
  import { NAV_TABS, loadNavConfig, scopesFor, groupScope, tabById, mobileBottomTabs, type NavConfig } from "$lib/nav";
  import { theme } from "$lib/themeStore.svelte";

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

  // ── Mobile navigation (unified across sidenav/topnav preference) ──────────
  let mobileNavOpen = $state(false);
  // Up to 5 priority tabs for the bottom bar; rest live in the drawer.
  const bottomTabs = $derived(mobileBottomTabs(visibleTabs, 5));
  // Close the off-canvas drawer whenever the route changes.
  $effect(() => {
    page.url.pathname; // track
    mobileNavOpen = false;
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

{#if navConfig.mode === "topnav"}
  <!-- ─── Top navigation layout ────────────────────────────────────────── -->
  <div
    class="grid h-full grid-cols-1 md:[grid-template-rows:auto_1fr] {showSidebar ? 'md:[grid-template-columns:240px_1fr]' : 'md:[grid-template-columns:1fr]'}"
  >
    <header class="col-span-full hidden items-center justify-between gap-4 border-b border-zinc-800 bg-zinc-950 px-4 py-2 md:flex">
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
      <aside class="row-start-2 hidden h-full min-w-0 flex-col border-r border-zinc-800 bg-zinc-900/40 md:flex">
        <div class="min-w-0 px-3 py-3">
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
        </div>
      </aside>
    {/if}

    <main class="h-full min-w-0 overflow-auto pt-[env(safe-area-inset-top)] pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:row-start-2 md:pt-0 md:pb-0">
      {@render children()}
    </main>
  </div>
{:else}
  <!-- ─── Side navigation layout (default) ─────────────────────────────── -->
  <div
    class="grid h-full grid-cols-1 {showSidebar ? 'md:[grid-template-columns:64px_240px_1fr]' : 'md:[grid-template-columns:64px_1fr]'}"
  >
    <nav class="hidden h-full w-16 flex-col items-center gap-1 border-r border-zinc-800 bg-zinc-950 py-3 md:flex">
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
      <aside class="hidden h-full min-w-0 flex-col border-r border-zinc-800 bg-zinc-900/40 md:flex">
        <div class="min-w-0 px-3 py-3">
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
        </div>
      </aside>
    {/if}

    <main class="h-full min-w-0 overflow-auto pt-[env(safe-area-inset-top)] pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pt-0 md:pb-0">
      {@render children()}
    </main>
  </div>
{/if}

<!-- ─── Mobile-only chrome (shared across both desktop nav modes) ─────────── -->
<!-- No top bar on mobile: the bottom tab bar (incl. "Mehr") is the single
     navigation surface. "Mehr" opens the off-canvas drawer below. -->

<!-- Off-canvas drawer + backdrop -->
{#if mobileNavOpen}
  <button
    type="button"
    class="fixed inset-0 z-40 bg-black/50 md:hidden"
    aria-label="Navigation schließen"
    onclick={() => (mobileNavOpen = false)}
  ></button>
{/if}
<aside
  class="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-zinc-800 bg-zinc-950 transition-transform duration-200 ease-out md:hidden
    {mobileNavOpen ? 'translate-x-0' : '-translate-x-full'}"
  aria-hidden={!mobileNavOpen}
>
  <div class="flex items-center justify-between border-b border-zinc-800 px-3 py-2.5">
    <a href="/" class="flex items-center gap-2">
      <span class="grid h-8 w-8 place-items-center rounded-lg bg-indigo-500/10 text-indigo-300">
        <Icon name="home" size={16} />
      </span>
      <span class="text-sm font-semibold tracking-tight">OpenSax</span>
    </a>
    <button
      type="button"
      class="grid h-9 w-9 place-items-center rounded-lg text-zinc-400 hover:bg-zinc-900"
      aria-label="Schließen"
      onclick={() => (mobileNavOpen = false)}
    >
      <Icon name="x" size={20} />
    </button>
  </div>

  <nav class="min-h-0 flex-1 overflow-y-auto px-2 py-3">
    <a
      href="/"
      class="mb-1 flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition
        {isActive('/') ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100'}"
    >
      <Icon name="home" size={20} />
      Übersicht
    </a>
    {#each visibleTabs as item}
      <a
        href={item.href}
        class="mb-1 flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition
          {isActive(item.href) ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100'}"
      >
        <Icon name={item.icon} size={20} />
        {item.label}
      </a>
    {/each}

    {#if showSidebar}
      <div class="my-2 h-px bg-zinc-800"></div>
      <p class="mb-1 px-3 text-xs font-medium uppercase tracking-wide text-zinc-500">Gruppen / Räume</p>
      {#if showPersonal}
        <button
          class="mb-1 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition
            {currentGroup === null ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-900'}"
          onclick={() => selectGroup(null)}
        ><span class="truncate">Persönlich</span></button>
      {/if}
      {#each filteredGroups as g}
        <button
          class="block w-full truncate rounded-lg px-3 py-2 text-left text-sm transition
            {currentGroup === g.login ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-900'}"
          onclick={() => selectGroup(g.login)}
          title={`${g.name}\n${g.login}`}
        >{g.name}</button>
      {/each}
    {/if}
  </nav>

  <div class="border-t border-zinc-800 px-3 py-2.5">
    <AvatarMenu displayName={data.displayName} email={data.email} seed={data.user?.login ?? data.email} placement="top-right" />
  </div>
</aside>

<!-- Bottom tab bar (YouTube-style) -->
<nav
  class="fixed inset-x-0 bottom-0 z-40 flex h-14 items-stretch border-t border-zinc-800 bg-zinc-950 pb-[env(safe-area-inset-bottom)] md:hidden"
>
  {#each bottomTabs as item}
    <a
      href={item.href}
      class="flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] transition
        {isActive(item.href) ? 'text-indigo-300' : 'text-zinc-400'}"
    >
      <Icon name={item.icon} size={22} />
      <span class="max-w-full truncate px-0.5">{item.label}</span>
    </a>
  {/each}
  <button
    type="button"
    class="flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] text-zinc-400"
    onclick={() => (mobileNavOpen = true)}
  >
    <Icon name="dots" size={22} />
    <span>Mehr</span>
  </button>
</nav>

<ComposeWindow />
