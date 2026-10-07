<script lang="ts">
  import { page } from "$app/state";
  import Icon from "$lib/Icon.svelte";
  import ScreenshotCropper from "$lib/ScreenshotCropper.svelte";
  import WizardFrame from "$lib/WizardFrame.svelte";
  import { feedback } from "$lib/feedbackStore.svelte";
  import { getLogs, type LogEntry } from "$lib/consoleBuffer";
  import { loadNavConfig } from "$lib/nav";
  import { theme } from "$lib/themeStore.svelte";
  import {
    AREAS,
    FEEDBACK_TYPES,
    LIMITS,
    STEPS,
    areaForPath,
    displayValue,
    isValidManualContact,
    type ContactMethod,
    type FeedbackPayload,
    type FeedbackType,
    type FieldDef,
    type ServerContext,
  } from "$lib/feedback";

  /**
   * Feedback-Wizard: Art → artspezifische Fragen → Anhänge → Kontakt →
   * Prüfen. Die Fragen pro Art kommen aus `$lib/feedback`, damit der Server
   * genau dasselbe prüft. Alles Optionale (Screenshot, Logs, technische
   * Infos, Account-Daten, Kontakt) ist standardmäßig aus und wird vor dem
   * Senden so angezeigt, wie es rausgeht.
   */

  type Include = FeedbackPayload["include"];

  let type = $state<FeedbackType | null>(null);
  let fields = $state<Record<string, string>>({});
  let stepIndex = $state(0);
  let include = $state<Include>({ screenshot: false, logs: false, config: false, account: false });
  let contactMethod = $state<ContactMethod>("none");
  let contactValue = $state("");
  let ctx = $state<ServerContext | null>(null);
  let ctxError = $state(false);
  let logs = $state<LogEntry[]>([]);
  let clientConfig = $state<Record<string, unknown>>({});
  let cropping = $state(false);
  let sending = $state(false);
  let error = $state<string | null>(null);
  let sentId = $state<string | null>(null);
  let confirmDiscard = $state(false);
  let showErrors = $state(false);

  // Reset whenever the wizard opens. Logs and config are snapshotted here, so
  // what is previewed is exactly what gets sent — not whatever the wizard
  // itself logs while it is open.
  $effect(() => {
    if (!feedback.open) return;
    type = null;
    fields = { area: areaForPath(page.url.pathname) };
    stepIndex = 0;
    include = { screenshot: false, logs: false, config: false, account: false };
    contactMethod = "none";
    contactValue = "";
    cropping = false;
    sending = false;
    error = null;
    sentId = null;
    confirmDiscard = false;
    showErrors = false;
    logs = getLogs();
    clientConfig = collectClientConfig();
    ctx = null;
    ctxError = false;
    fetch("/api/feedback")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: ServerContext) => (ctx = d))
      .catch(() => (ctxError = true));
  });

  $effect(() => {
    if (!feedback.open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") requestClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  function collectClientConfig(): Record<string, unknown> {
    const nav = loadNavConfig();
    return {
      route: { path: page.url.pathname, query_keys: [...new Set(page.url.searchParams.keys())] },
      navigation: { mode: nav.mode, visible: nav.visible, hidden: nav.hidden },
      theme: { preference: theme.pref, effective: theme.effective },
      viewport: { width: window.innerWidth, height: window.innerHeight, pixel_ratio: window.devicePixelRatio },
      installed_app: matchMedia("(display-mode: standalone)").matches,
      user_agent: navigator.userAgent,
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      online: navigator.onLine,
    };
  }

  // ── Steps ────────────────────────────────────────────────────────────
  type Step = { id: string; title: string; intro?: string; fields?: FieldDef[] };
  const steps = $derived<Step[]>([
    { id: "type", title: "Worum geht es?" },
    ...(type ? STEPS[type] : []),
    {
      id: "attachments",
      title: "Was dürfen wir mitschicken?",
      intro: "Alles hier ist freiwillig. Du siehst unten genau, was gesendet wird.",
    },
    { id: "contact", title: "Sollen wir uns melden?" },
    { id: "review", title: "Alles richtig?" },
  ]);
  const step = $derived(steps[Math.min(stepIndex, steps.length - 1)]!);
  const isLast = $derived(stepIndex === steps.length - 1);

  function fieldError(f: FieldDef): string | null {
    const v = (fields[f.key] ?? "").trim();
    if (f.required && !v) return "Bitte ausfüllen.";
    const max = f.kind === "textarea" ? LIMITS.textarea : LIMITS.text;
    if (v.length > max) return `Höchstens ${max} Zeichen.`;
    return null;
  }

  const stepValid = $derived.by(() => {
    if (step.id === "type") return !!type;
    if (step.fields) return step.fields.every((f) => !fieldError(f));
    if (step.id === "contact") return contactMethod !== "manual" || isValidManualContact(contactValue);
    if (step.id === "attachments") return !include.screenshot || !!feedback.screenshot;
    return true;
  });

  function next() {
    if (!stepValid) {
      showErrors = true;
      return;
    }
    showErrors = false;
    stepIndex += 1;
  }
  function back() {
    showErrors = false;
    cropping = false;
    if (stepIndex > 0) stepIndex -= 1;
  }
  function pickType(t: FeedbackType) {
    type = t;
    next();
  }

  // ── Closing ──────────────────────────────────────────────────────────
  const dirty = $derived(
    !sentId && (!!type || Object.entries(fields).some(([k, v]) => k !== "area" && v.trim())),
  );
  function requestClose() {
    if (sending) return;
    if (cropping) { cropping = false; return; }
    if (dirty && !confirmDiscard) { confirmDiscard = true; return; }
    feedback.close();
  }

  // ── Attachments ──────────────────────────────────────────────────────
  const screenshotKb = $derived(
    feedback.screenshot ? Math.round((feedback.screenshot.current.length * 3) / 4 / 1024) : 0,
  );
  const cropped = $derived(!!feedback.screenshot && feedback.screenshot.current !== feedback.screenshot.original);
  const errorLogCount = $derived(logs.filter((l) => l.level === "error" || l.level === "warn").length);

  function selectRecommended() {
    include = { ...include, screenshot: !!feedback.screenshot, logs: true, config: true };
  }

  function fmtTime(t: number) {
    return new Date(t).toLocaleTimeString("de-DE");
  }

  // ── Sending ──────────────────────────────────────────────────────────
  function payload(): FeedbackPayload {
    const clean: Record<string, string> = {};
    for (const f of type ? STEPS[type].flatMap((s) => s.fields) : []) {
      const v = (fields[f.key] ?? "").trim();
      if (v) clean[f.key] = v;
    }
    return {
      type: type!,
      fields: clean,
      include: { ...include },
      screenshot: include.screenshot ? feedback.screenshot?.current : undefined,
      logs: include.logs ? logs : undefined,
      client_config: include.config ? clientConfig : undefined,
      contact: { method: contactMethod, value: contactMethod === "manual" ? contactValue.trim() : undefined },
    };
  }

  /** What goes out, as the recipient will see it — the server's additions included. */
  const preview = $derived.by(() => {
    if (!type || step.id !== "review") return null;
    const p = payload();
    return {
      ...p,
      screenshot: p.screenshot ? `[Bild, ${feedback.screenshot?.width}×${feedback.screenshot?.height}, ${screenshotKb} KB]` : undefined,
      logs: p.logs ? `[${p.logs.length} Einträge]` : undefined,
      config: include.config ? { client: clientConfig, server: ctx?.config ?? "(wird vom Server ergänzt)" } : undefined,
      client_config: undefined,
      account: include.account ? ctx?.account ?? "(wird vom Server ergänzt)" : undefined,
      contact: {
        method: contactMethod,
        value: contactMethod === "lernsax" ? ctx?.lernsax_email : contactMethod === "manual" ? contactValue.trim() : undefined,
      },
    };
  });

  async function send() {
    if (!type || sending) return;
    sending = true;
    error = null;
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload()),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) error = "Zu viele Meldungen in kurzer Zeit. Bitte versuche es in ein paar Minuten noch einmal.";
      else if (!res.ok) error = data.error ?? "Senden fehlgeschlagen.";
      else sentId = data.id;
    } catch {
      error = "Keine Verbindung zum Server.";
    } finally {
      sending = false;
    }
  }

  const inputClass = "w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500";
</script>

{#snippet toggle(key: keyof Include, label: string, desc: string, icon: string, disabled = false)}
  <label class="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition
    {include[key] ? 'border-indigo-500/60 bg-indigo-500/5' : 'border-zinc-800 hover:bg-zinc-900'}
    {disabled ? 'pointer-events-none opacity-50' : ''}">
    <input type="checkbox" class="mt-1 accent-indigo-500" bind:checked={include[key]} {disabled} />
    <span class="mt-0.5 text-zinc-400"><Icon name={icon} size={18} /></span>
    <span class="min-w-0 flex-1">
      <span class="block text-sm font-medium">{label}</span>
      <span class="block text-xs text-zinc-500">{desc}</span>
    </span>
  </label>
{/snippet}

{#snippet field(f: FieldDef)}
  {@const err = showErrors ? fieldError(f) : null}
  <div class="space-y-1.5">
    <label class="block text-sm font-medium" for="fb-{f.key}">
      {f.label}{#if f.required}<span class="text-indigo-400"> *</span>{/if}
    </label>
    {#if f.kind === "text"}
      <input id="fb-{f.key}" class={inputClass} maxlength={LIMITS.text} placeholder={f.placeholder} bind:value={fields[f.key]} />
    {:else if f.kind === "textarea"}
      <textarea id="fb-{f.key}" rows="4" class="{inputClass} resize-y" maxlength={LIMITS.textarea} placeholder={f.placeholder} bind:value={fields[f.key]}></textarea>
    {:else if f.kind === "area"}
      <select id="fb-{f.key}" class={inputClass} bind:value={fields[f.key]}>
        {#each AREAS as a}<option value={a.value}>{a.label}</option>{/each}
      </select>
    {:else if f.kind === "choice"}
      <div id="fb-{f.key}" class="flex flex-wrap gap-2" role="radiogroup">
        {#each f.options ?? [] as o}
          <button
            type="button"
            role="radio"
            aria-checked={fields[f.key] === o.value}
            onclick={() => (fields[f.key] = o.value)}
            class="rounded-full border px-3 py-1.5 text-sm transition
              {fields[f.key] === o.value ? 'border-indigo-500 bg-indigo-500/15 text-indigo-200' : 'border-zinc-800 text-zinc-300 hover:bg-zinc-900'}"
          >{o.label}</button>
        {/each}
      </div>
    {/if}
    {#if f.hint}<p class="text-xs text-zinc-500">{f.hint}</p>{/if}
    {#if err}<p class="text-xs text-red-400">{err}</p>{/if}
  </div>
{/snippet}

{#if feedback.capturing && !feedback.open}
  <div data-feedback-ignore class="fixed bottom-20 left-1/2 z-[60] -translate-x-1/2 rounded-full border border-zinc-800 bg-zinc-950 px-4 py-2 text-sm text-zinc-300 shadow-xl md:bottom-6">
    Screenshot wird erstellt…
  </div>
{/if}

{#snippet discardBanner()}
  {#if confirmDiscard}
    <div class="flex items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/10 px-5 py-2.5 text-sm">
      <span class="text-amber-200">Deine Eingaben verwerfen?</span>
      <div class="flex gap-2">
        <button type="button" class="rounded-md px-2 py-1 text-zinc-300 hover:text-zinc-100" onclick={() => (confirmDiscard = false)}>Weiter bearbeiten</button>
        <button type="button" class="rounded-md bg-amber-500/20 px-2 py-1 text-amber-200 hover:bg-amber-500/30" onclick={() => feedback.close()}>Verwerfen</button>
      </div>
    </div>
  {/if}
{/snippet}

{#snippet stepNav()}
  {#if sentId}
    <span></span>
    <button type="button" onclick={() => feedback.close()} class="rounded-md bg-indigo-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-400">Schließen</button>
  {:else}
    <button
      type="button"
      onclick={back}
      disabled={stepIndex === 0 || sending}
      class="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-zinc-400 hover:text-zinc-100 disabled:invisible"
    ><Icon name="chevron-left" size={16} /> Zurück</button>
    <span class="text-xs text-zinc-600">{stepIndex + 1} / {steps.length}</span>
    {#if isLast}
      <button
        type="button"
        onclick={send}
        disabled={sending}
        class="flex items-center gap-1.5 rounded-md bg-indigo-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-60"
      ><Icon name="send" size={16} /> {sending ? "Wird gesendet…" : "Absenden"}</button>
    {:else if step.id !== "type" || type}
      <button
        type="button"
        onclick={next}
        class="flex items-center gap-1 rounded-md bg-indigo-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-400"
      >Weiter <Icon name="chevron-right" size={16} /></button>
    {:else}
      <span class="w-20"></span>
    {/if}
  {/if}
{/snippet}

{#if feedback.open}
  <WizardFrame
    title={sentId ? "Danke!" : step.title}
    badge={type && !sentId ? FEEDBACK_TYPES[type].short : null}
    stepCount={sentId ? 0 : steps.length}
    {stepIndex}
    onclose={requestClose}
    scrollKey={stepIndex}
    banner={discardBanner}
    footer={cropping ? undefined : stepNav}
  >
    {#if sentId}
      <div class="space-y-3 py-6 text-center">
        <div class="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-500/15 text-emerald-400">
          <Icon name="check" size={26} />
        </div>
        <p class="text-sm text-zinc-300">Deine Meldung ist angekommen.</p>
        <p class="text-xs text-zinc-500">Kennung: <code class="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-300">{sentId}</code></p>
        {#if contactMethod === "none"}
          <p class="text-xs text-zinc-500">Du hast keinen Kontaktweg angegeben — wir melden uns also nicht zurück.</p>
        {/if}
      </div>

    {:else if step.id === "type"}
      <div class="grid gap-2 sm:grid-cols-2">
        {#each Object.entries(FEEDBACK_TYPES) as [key, t]}
          <button
            type="button"
            onclick={() => pickType(key as FeedbackType)}
            class="flex items-start gap-3 rounded-xl border p-3 text-left transition
              {type === key ? 'border-indigo-500 bg-indigo-500/10' : 'border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900'}"
          >
            <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-zinc-900 text-indigo-300"><Icon name={t.icon} size={20} /></span>
            <span>
              <span class="block text-sm font-medium">{t.label}</span>
              <span class="block text-xs text-zinc-500">{t.desc}</span>
            </span>
          </button>
        {/each}
      </div>

    {:else if step.fields}
      {#if step.intro}<p class="text-sm text-zinc-400">{step.intro}</p>{/if}
      {#each step.fields as f (f.key)}
        {@render field(f)}
      {/each}

    {:else if step.id === "attachments"}
      {#if cropping && feedback.screenshot}
        <ScreenshotCropper
          src={feedback.screenshot.original}
          onapply={(url, w, h) => { feedback.setCurrent(url, w, h); cropping = false; include.screenshot = true; }}
          oncancel={() => (cropping = false)}
        />
      {:else}
        <p class="text-sm text-zinc-400">{step.intro}</p>
        {#if type === "bug"}
          <div class="flex items-center justify-between gap-3 rounded-lg bg-indigo-500/10 px-3 py-2 text-xs text-indigo-200">
            <span>Bei Fehlern helfen Screenshot, Logs und technische Infos am meisten.</span>
            <button type="button" class="shrink-0 rounded-md bg-indigo-500/20 px-2 py-1 hover:bg-indigo-500/30" onclick={selectRecommended}>Auswählen</button>
          </div>
        {/if}

        <!-- Screenshot -->
        <div class="space-y-2">
          {@render toggle("screenshot", "Screenshot", feedback.screenshot ? `Von der Seite, auf der du warst · ${screenshotKb} KB${cropped ? " · zugeschnitten" : ""}` : (feedback.screenshotError ?? "Wird erstellt…"), "camera", !feedback.screenshot)}
          {#if feedback.screenshot}
            <div class="flex items-start gap-3 pl-1">
              <img src={feedback.screenshot.current} alt="Screenshot-Vorschau" class="max-h-32 w-auto max-w-[55%] rounded-md border border-zinc-800 object-contain" />
              <div class="flex flex-col gap-1 text-xs">
                <button type="button" class="flex items-center gap-1.5 rounded-md px-2 py-1 text-zinc-300 hover:bg-zinc-900" onclick={() => (cropping = true)}>
                  <Icon name="crop" size={14} /> Zuschneiden
                </button>
                {#if cropped}
                  <button type="button" class="flex items-center gap-1.5 rounded-md px-2 py-1 text-zinc-300 hover:bg-zinc-900" onclick={() => feedback.resetCrop()}>
                    <Icon name="refresh" size={14} /> Ganzer Bildschirm
                  </button>
                {/if}
              </div>
            </div>
          {/if}
          {#if !feedback.screenshot}
            <button type="button" disabled={feedback.capturing} onclick={() => feedback.retake()} class="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-900 disabled:opacity-50">
              <Icon name="refresh" size={14} /> {feedback.capturing ? "Wird erstellt…" : "Erneut versuchen"}
            </button>
          {/if}
          {#if include.screenshot}
            <p class="pl-1 text-xs text-amber-300/80">Auf dem Bild können Namen, Mails oder Dateien zu sehen sein — schneide es bei Bedarf zu.</p>
          {/if}
        </div>

        <!-- Logs -->
        <div class="space-y-2">
          {@render toggle("logs", "Browser-Logs", `${logs.length} Einträge${errorLogCount ? `, davon ${errorLogCount} Warnungen/Fehler` : ""} seit dem Laden der Seite`, "terminal-2", logs.length === 0)}
          {#if include.logs}
            <details class="rounded-md border border-zinc-800 text-xs">
              <summary class="cursor-pointer px-3 py-1.5 text-zinc-400">Inhalt anzeigen</summary>
              <pre class="max-h-48 overflow-auto whitespace-pre-wrap break-all border-t border-zinc-800 px-3 py-2 text-[11px] text-zinc-400">{#each logs as l}<span class={l.level === "error" ? "text-red-400" : l.level === "warn" ? "text-amber-300" : ""}>{fmtTime(l.t)} [{l.level}] {l.msg}</span>
{/each}</pre>
            </details>
          {/if}
        </div>

        <!-- Config without real names -->
        <div class="space-y-2">
          {@render toggle("config", "Technische Infos (ohne Namen)", "Browser, Bildschirmgröße, Navigation, Theme, ob ein Stundenplan eingerichtet ist, Anzahl Gruppen", "adjustments")}
          {#if include.config}
            <details class="rounded-md border border-zinc-800 text-xs">
              <summary class="cursor-pointer px-3 py-1.5 text-zinc-400">Inhalt anzeigen</summary>
              <pre class="max-h-48 overflow-auto border-t border-zinc-800 px-3 py-2 text-[11px] text-zinc-400">{JSON.stringify({ client: clientConfig, server: ctx?.config ?? (ctxError ? "(nicht abrufbar)" : "…") }, null, 2)}</pre>
            </details>
          {/if}
        </div>

        <!-- Account -->
        <div class="space-y-2">
          {@render toggle("account", "Meine Account-Daten", "Name, LernSax-Login, Schule und Klassen — hilft bei Problemen mit einem bestimmten Account", "user")}
          {#if include.account}
            <div class="rounded-md border border-zinc-800 px-3 py-2 text-xs text-zinc-400">
              {#if ctx}
                <p>{ctx.account.name || "—"} · {ctx.account.login}</p>
                {#if ctx.account.schools.length}<p>Schule: {ctx.account.schools.join(", ")}</p>{/if}
                {#if ctx.account.classes.length}<p>Klassen/Gruppen: {ctx.account.classes.join(", ")}</p>{/if}
              {:else}
                <p>{ctxError ? "Konnte nicht geladen werden — wird beim Senden vom Server ergänzt." : "Wird geladen…"}</p>
              {/if}
            </div>
          {/if}
        </div>
      {/if}

    {:else if step.id === "contact"}
      <p class="text-sm text-zinc-400">
        {type === "question" ? "Für eine Antwort brauchen wir einen Weg, dich zu erreichen." : "Falls wir Rückfragen haben oder dir Bescheid geben sollen, wenn es erledigt ist."}
      </p>
      <div class="space-y-2" role="radiogroup">
        {#each [
          { v: "none", label: "Keine Rückmeldung", desc: "Die Meldung geht ohne Kontaktdaten raus.", icon: "eye-off" },
          { v: "lernsax", label: "Per LernSax-Mail", desc: ctx?.lernsax_email ? `An ${ctx.lernsax_email} — wird automatisch übermittelt.` : "Deine LernSax-Adresse wird automatisch übermittelt.", icon: "mail" },
          { v: "manual", label: "Andere E-Mail oder Telefonnummer", desc: "Selbst eingeben.", icon: "phone" },
        ] as o}
          <label class="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition
            {contactMethod === o.v ? 'border-indigo-500/60 bg-indigo-500/5' : 'border-zinc-800 hover:bg-zinc-900'}">
            <input type="radio" name="fb-contact" class="mt-1 accent-indigo-500" value={o.v} bind:group={contactMethod} />
            <span class="mt-0.5 text-zinc-400"><Icon name={o.icon} size={18} /></span>
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-medium">{o.label}</span>
              <span class="block break-words text-xs text-zinc-500">{o.desc}</span>
            </span>
          </label>
        {/each}
      </div>
      {#if contactMethod === "manual"}
        <div class="space-y-1.5">
          <input
            class={inputClass}
            placeholder="name@example.de oder +49 …"
            maxlength="200"
            bind:value={contactValue}
            aria-label="E-Mail oder Telefonnummer"
          />
          {#if (showErrors || contactValue.trim()) && !isValidManualContact(contactValue)}
            <p class="text-xs text-red-400">Bitte eine gültige E-Mail-Adresse oder Telefonnummer eingeben.</p>
          {/if}
        </div>
      {/if}
      {#if type === "question" && contactMethod === "none"}
        <p class="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-200">Ohne Kontaktweg können wir dir nicht antworten.</p>
      {/if}

    {:else if step.id === "review" && type}
      <dl class="space-y-3 text-sm">
        <div>
          <dt class="text-xs text-zinc-500">Art</dt>
          <dd>{FEEDBACK_TYPES[type].label}</dd>
        </div>
        {#each STEPS[type].flatMap((s) => s.fields) as f (f.key)}
          {#if fields[f.key]?.trim()}
            <div>
              <dt class="text-xs text-zinc-500">{f.label}</dt>
              <dd class="whitespace-pre-wrap break-words">{displayValue(f, fields[f.key]!.trim())}</dd>
            </div>
          {/if}
        {/each}
        <div>
          <dt class="text-xs text-zinc-500">Anhänge</dt>
          <dd>
            {[
              include.screenshot && "Screenshot",
              include.logs && `Browser-Logs (${logs.length})`,
              include.config && "Technische Infos",
              include.account && "Account-Daten",
            ].filter(Boolean).join(", ") || "Keine"}
          </dd>
        </div>
        <div>
          <dt class="text-xs text-zinc-500">Kontakt</dt>
          <dd>
            {contactMethod === "none" ? "Keine Rückmeldung" : contactMethod === "lernsax" ? `LernSax-Mail (${ctx?.lernsax_email ?? "aus deinem Account"})` : contactValue.trim()}
          </dd>
        </div>
      </dl>
      {#if include.screenshot && feedback.screenshot}
        <img src={feedback.screenshot.current} alt="Screenshot, der gesendet wird" class="max-h-40 rounded-md border border-zinc-800" />
      {/if}
      <details class="rounded-md border border-zinc-800 text-xs">
        <summary class="cursor-pointer px-3 py-1.5 text-zinc-400">Genau diese Daten werden gesendet</summary>
        <pre class="max-h-64 overflow-auto whitespace-pre-wrap break-all border-t border-zinc-800 px-3 py-2 text-[11px] text-zinc-400">{JSON.stringify(preview, null, 2)}</pre>
      </details>
      {#if error}
        <p class="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>
      {/if}
    {/if}
  </WizardFrame>
{/if}
