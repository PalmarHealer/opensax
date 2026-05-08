<script lang="ts">
  import { enhance } from "$app/forms";
  import { goto, invalidateAll } from "$app/navigation";
  import { page } from "$app/state";
  import Icon from "$lib/Icon.svelte";
  import Modal from "$lib/Modal.svelte";
  import PersonChip from "$lib/PersonChip.svelte";

  let { data } = $props();
  let sendError = $state<string | null>(null);

  type Msg = { id: number; from_login: string; to_login: string; text: string; date: number; is_unread?: boolean };
  function bucket(history: Msg[], myLogin: string | undefined): Map<string, Msg[]> {
    const m = new Map<string, Msg[]>();
    for (const msg of history) {
      const other = msg.from_login === myLogin ? msg.to_login : msg.from_login;
      const arr = m.get(other) ?? [];
      arr.push(msg);
      m.set(other, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.date - b.date);
    return m;
  }

  const myLogin = "";
  const chats = $derived(bucket(data.history as Msg[], myLogin));
  const partners = $derived([...chats.keys()]);

  // Active conversation lives in the URL (?with=) so the layout switch / back/fwd preserves it.
  const activeFromUrl = $derived(page.url.searchParams.get("with"));
  const active = $derived<string | null>(activeFromUrl || partners[0] || null);
  function setActive(login: string | null) {
    const u = new URL(page.url);
    if (login) u.searchParams.set("with", login);
    else u.searchParams.delete("with");
    goto(u.pathname + u.search, { keepFocus: true, noScroll: true, replaceState: false });
  }
  let draft = $state("");

  function fmt(ts: number): string {
    return new Date(ts * 1000).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
  }
  async function refresh() { await invalidateAll(); }

  // New chat: pick from groups members or type manually
  let newChatOpen = $state(false);
  let memberFilter = $state("");
  let manualLogin = $state("");

  function startChat(login: string) {
    if (!login.trim()) return;
    setActive(login.trim());
    manualLogin = "";
    memberFilter = "";
    newChatOpen = false;
  }

  // Display name lookup (members from groups)
  const nameByLogin = $derived(new Map(data.members.map((m) => [m.login, m.name_hr])));
  function partnerLabel(login: string): string {
    return nameByLogin.get(login) ?? login;
  }

  const filteredMembers = $derived.by(() => {
    const q = memberFilter.trim().toLowerCase();
    if (!q) return data.members;
    return data.members.filter(
      (m) => m.name_hr.toLowerCase().includes(q) || m.login.toLowerCase().includes(q),
    );
  });
</script>

<div class="grid h-full" style="grid-template-columns: 240px 1fr">
  <!-- Conversation list -->
  <aside class="flex h-full flex-col border-r border-zinc-800 bg-zinc-900/40">
    <div class="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
      <h1 class="text-sm font-semibold uppercase tracking-wide text-zinc-400">Chats</h1>
      <button
        onclick={() => (newChatOpen = true)}
        class="grid h-7 w-7 place-items-center rounded-md border border-zinc-800 bg-zinc-950 hover:bg-zinc-800"
        title="Neuer Chat"
        aria-label="Neuer Chat"
      ><Icon name="plus" size={14} /></button>
    </div>
    <div class="flex-1 overflow-auto py-2">
      {#if partners.length === 0}
        <p class="px-4 py-6 text-center text-xs text-zinc-500">Keine Konversationen.</p>
      {/if}
      {#each partners as p}
        {@const msgs = chats.get(p) ?? []}
        {@const last = msgs[msgs.length - 1]}
        <button
          class="block w-full px-4 py-3 text-left transition hover:bg-zinc-900/60 {active === p ? 'bg-zinc-800/60' : ''}"
          onclick={() => setActive(p)}
        >
          <p class="truncate text-sm font-medium">{partnerLabel(p)}</p>
          <p class="truncate text-[11px] text-zinc-500">{p}</p>
          {#if last}
            <p class="mt-0.5 truncate text-xs text-zinc-500">{last.text}</p>
          {/if}
        </button>
      {/each}
    </div>
  </aside>

  <!-- Active conversation -->
  <main class="flex h-full flex-col">
    {#if !active}
      <div class="grid flex-1 place-items-center text-sm text-zinc-500">
        <div class="text-center">
          <div class="mb-3 inline-grid h-12 w-12 place-items-center rounded-2xl bg-zinc-900 text-zinc-600">
            <Icon name="message-circle" size={28} />
          </div>
          <p>Wähle einen Chat aus oder starte einen neuen.</p>
          <button onclick={() => (newChatOpen = true)} class="mt-3 text-xs text-indigo-400 hover:text-indigo-300">+ Neuer Chat</button>
        </div>
      </div>
    {:else}
      <header class="flex items-center justify-between border-b border-zinc-800 bg-zinc-950/80 px-6 py-3">
        <div>
          <p class="text-sm font-semibold"><PersonChip name={partnerLabel(active)} login={active} /></p>
          <p class="text-[11px] text-zinc-500">{active}</p>
        </div>
        <button onclick={refresh} class="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300">
          <Icon name="refresh" size={14} /> Aktualisieren
        </button>
      </header>

      <ol class="flex-1 space-y-2 overflow-auto px-6 py-4">
        {#each chats.get(active) ?? [] as msg}
          {@const mine = msg.to_login === active}
          <li class="flex {mine ? 'justify-end' : 'justify-start'}">
            <div class="max-w-[70%] rounded-2xl px-3 py-2 text-sm
              {mine ? 'bg-indigo-500 text-white' : 'bg-zinc-800 text-zinc-100'}">
              <p class="whitespace-pre-wrap break-words">{msg.text}</p>
              <p class="mt-1 text-[10px] opacity-60">{fmt(msg.date)}</p>
            </div>
          </li>
        {:else}
          <li class="py-8 text-center text-sm text-zinc-500">Keine Nachrichten — schreib die erste.</li>
        {/each}
      </ol>

      {#if sendError}
        <div class="border-t border-red-900/40 bg-red-950/40 px-4 py-2 text-xs text-red-300" role="alert">
          {sendError}
        </div>
      {/if}
      <form
        method="POST"
        action="?/send"
        use:enhance={() => async ({ result, update }) => {
          await update({ reset: false });
          if (result.type === "success") { sendError = null; draft = ""; }
          else if (result.type === "failure") sendError = (result.data as { error?: string } | undefined)?.error ?? "Senden fehlgeschlagen";
        }}
        class="flex items-center gap-2 border-t border-zinc-800 bg-zinc-950 px-4 py-3"
      >
        <input type="hidden" name="to_login" value={active} />
        <input
          name="text"
          bind:value={draft}
          placeholder="Nachricht…"
          required
          class="flex-1 rounded-full border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm outline-none focus:border-indigo-500"
        />
        <button class="grid h-9 w-9 place-items-center rounded-full bg-indigo-500 text-white hover:bg-indigo-400" aria-label="Senden">
          <Icon name="send" size={16} />
        </button>
      </form>
    {/if}
  </main>
</div>

<Modal open={newChatOpen} onclose={() => (newChatOpen = false)} title="Neuer Chat" width="max-w-lg">
  {#if data.members.length > 0}
    <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Aus deinen Gruppen</p>
    <input
      type="text"
      bind:value={memberFilter}
      placeholder="Name suchen…"
      class="mb-3 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-indigo-500"
    />
    <div class="max-h-72 space-y-0.5 overflow-auto rounded-md border border-zinc-800 bg-zinc-950/50 p-1">
      {#each filteredMembers as m}
        <button
          class="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-900"
          onclick={() => startChat(m.login)}
        >
          <span class="flex min-w-0 items-center gap-2">
            {#if m.online}
              <span class="h-2 w-2 shrink-0 rounded-full bg-emerald-400" title="online"></span>
            {:else}
              <span class="h-2 w-2 shrink-0 rounded-full bg-zinc-700"></span>
            {/if}
            <span class="truncate">{m.name_hr}</span>
          </span>
          <span class="truncate text-[11px] text-zinc-500">{m.groups.join(", ")}</span>
        </button>
      {:else}
        <p class="px-2 py-3 text-center text-xs text-zinc-500">Niemand passt.</p>
      {/each}
    </div>
    <div class="mt-4 border-t border-zinc-800 pt-4">
      <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Oder Email/Login eingeben</p>
      <div class="flex gap-2">
        <input
          type="email"
          bind:value={manualLogin}
          placeholder="vorname.nachname@schule.lernsax.de"
          onkeydown={(e) => { if (e.key === "Enter") startChat(manualLogin); }}
          class="flex-1 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-indigo-500"
        />
        <button onclick={() => startChat(manualLogin)} class="rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium hover:bg-indigo-400">Starten</button>
      </div>
    </div>
  {:else}
    <p class="mb-3 text-sm text-zinc-400">Email/Login des Empfängers eingeben.</p>
    <input
      type="email"
      bind:value={manualLogin}
      placeholder="vorname.nachname@schule.lernsax.de"
      onkeydown={(e) => { if (e.key === "Enter") startChat(manualLogin); }}
      class="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-indigo-500"
    />
    <div class="mt-4 flex justify-end gap-2">
      <button onclick={() => (newChatOpen = false)} class="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-100">Abbrechen</button>
      <button onclick={() => startChat(manualLogin)} class="rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium hover:bg-indigo-400">Starten</button>
    </div>
  {/if}
</Modal>
