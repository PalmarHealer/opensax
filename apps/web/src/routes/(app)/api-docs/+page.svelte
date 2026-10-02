<script lang="ts">
  /**
   * API reference, rendered from the OpenAPI document the MCP container
   * generates from its tool list — so it always matches what the API accepts.
   */
  import { onMount } from "svelte";

  let { data } = $props();

  type Schema = {
    type?: string | string[];
    enum?: unknown[];
    const?: unknown;
    anyOf?: Schema[];
    items?: Schema;
    properties?: Record<string, Schema>;
    required?: string[];
    additionalProperties?: Schema | boolean;
    default?: unknown;
    description?: string;
    pattern?: string;
    format?: string;
    minimum?: number;
    maximum?: number;
    exclusiveMinimum?: number;
  };

  interface Op {
    name: string;
    description: string;
    category: string;
    readOnly: boolean;
    schema: Schema;
  }

  let origin = $state("https://<deine-instanz>");
  onMount(() => {
    origin = location.origin;
  });
  const base = $derived(`${origin}/api/v1`);

  const ops = $derived.by<Op[]>(() => {
    const spec = data.spec;
    if (!spec) return [];
    const out: Op[] = [];
    for (const ops of Object.values(spec.paths)) {
      const op = ops.post;
      if (!op?.["x-opensax-scope"]) continue;
      out.push({
        name: op.operationId,
        description: op.description ?? "",
        category: op.tags?.[0] ?? "Sonstiges",
        readOnly: op["x-opensax-read-only"] === true,
        schema: (op.requestBody?.content["application/json"]?.schema ?? {}) as Schema,
      });
    }
    return out;
  });
  const categories = $derived([...new Set(ops.map((o) => o.category))]);

  let filter = $state("");
  const visible = $derived(
    filter.trim()
      ? ops.filter((o) => (o.name + " " + o.description).toLowerCase().includes(filter.trim().toLowerCase()))
      : ops,
  );

  function typeLabel(s: Schema): string {
    if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join(" | ");
    if (s.const !== undefined) return JSON.stringify(s.const);
    if (s.anyOf) return s.anyOf.map(typeLabel).join(" | ");
    if (s.type === "array") return `${s.items ? typeLabel(s.items) : "unknown"}[]`;
    if (s.type === "object" && s.properties) {
      return `{ ${Object.entries(s.properties).map(([k, v]) => `${k}${s.required?.includes(k) ? "" : "?"}: ${typeLabel(v)}`).join(", ")} }`;
    }
    if (s.type === "object") return "object";
    if (Array.isArray(s.type)) return s.type.join(" | ");
    return s.type ?? "any";
  }
  function constraints(s: Schema): string[] {
    const out: string[] = [];
    if (s.format) out.push(s.format);
    if (s.pattern) out.push(`Muster ${s.pattern}`);
    if (s.minimum !== undefined) out.push(`≥ ${s.minimum}`);
    if (s.exclusiveMinimum !== undefined) out.push(`> ${s.exclusiveMinimum}`);
    if (s.maximum !== undefined) out.push(`≤ ${s.maximum}`);
    if (s.default !== undefined) out.push(`Standard ${JSON.stringify(s.default)}`);
    return out;
  }
  function example(s: Schema): string {
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s.properties ?? {})) {
      if (!s.required?.includes(k)) continue;
      body[k] = v.enum ? v.enum[0] : v.type === "integer" || v.type === "number" ? 0 : v.type === "boolean" ? false : v.type === "array" ? [] : "…";
    }
    return JSON.stringify(body);
  }
  function curl(op: Op): string {
    const body = example(op.schema);
    return `curl -X POST ${base}/${op.name} \\\n  -H "Authorization: Bearer $OPENSAX_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d '${body}'`;
  }

  const ERRORS: Array<[string, string, string]> = [
    ["400", "invalid_arguments", "Argumente passen nicht zum Schema — `details` nennt die Felder. Unbekannte Felder werden abgelehnt."],
    ["401", "unauthenticated / invalid_token", "Kein oder ein unbekanntes Token."],
    ["401", "token_expired", "Das Token ist abgelaufen."],
    ["401", "no_session", "Zum Account ist keine Anmeldung mehr gespeichert. Einmal in der Weboberfläche anmelden."],
    ["403", "insufficient_scope", "Das Token darf dieses Tool nicht aufrufen."],
    ["404", "unknown_tool", "Kein Tool mit diesem Namen."],
    ["409", "not_configured", "Voraussetzung fehlt, z.B. kein Stundenplan hinterlegt."],
    ["429", "rate_limited", "Zu viele Anfragen (Standard 120 pro Minute und Token, 30 fehlgeschlagene Anmeldungen pro Minute und IP). `Retry-After` sagt, wann es weitergeht."],
    ["500", "server_misconfigured", "Der Server kann gespeicherte Anmeldungen nicht entschlüsseln — ein Fehler beim Betreiber, nicht am Token."],
    ["502", "upstream_*", "LernSax hat abgelehnt oder war nicht erreichbar."],
  ];
</script>

<div class="h-full overflow-auto">
  <div class="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-10">
    <h1 class="mb-1 text-2xl font-semibold tracking-tight">OpenSax API</h1>
    <p class="mb-6 text-sm text-zinc-400">
      Programmatischer Zugriff auf deinen LernSax-Account. Jede Operation ist ein Tool — dieselben wie beim MCP-Server —
      und jedes Tool ist ein eigener Scope.
    </p>

    {#if !data.spec}
      <p class="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">
        Der API-Server ist gerade nicht erreichbar, deshalb fehlt die Tool-Liste. Versuch es gleich noch einmal.
      </p>
    {/if}

    <section class="mb-4 space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 text-sm">
      <h2 class="text-sm font-semibold uppercase tracking-wide text-zinc-400">Grundlagen</h2>
      <div>
        <p class="font-medium">Basis-URL</p>
        <code class="text-xs text-zinc-300">{base}</code>
      </div>
      <div>
        <p class="font-medium">Authentifizierung</p>
        <p class="text-zinc-400">
          <code>Authorization: Bearer &lt;token&gt;</code>. Tokens erstellst du unter
          <a href="/settings?tab=connections" class="text-indigo-400 hover:text-indigo-300">Einstellungen → Verbindungen</a>,
          wählst dort die erlaubten Tools und das Ablaufdatum. Das Token wird nur einmal angezeigt; gespeichert wird nur sein Hash.
          Es nutzt die Anmeldedaten, mit denen du dich in OpenSax angemeldet hast, und funktioniert, solange du auf mindestens einem Gerät angemeldet bist.
        </p>
      </div>
      <div>
        <p class="font-medium">Aufruf</p>
        <p class="text-zinc-400">
          <code>POST /api/v1/&lt;tool&gt;</code> mit den Argumenten als JSON-Body (leerer Body = keine Argumente).
          Die Antwort ist das JSON, das LernSax liefert; <code>files_download</code> antwortet mit der Datei selbst.
        </p>
        <pre class="mt-2 overflow-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs">curl -X POST {base}/mail_list \
  -H "Authorization: Bearer $OPENSAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{JSON.stringify({ folder_id: "INBOX", limit: 10 })}'</pre>
      </div>
      <div>
        <p class="font-medium">Weitere Endpunkte</p>
        <ul class="text-zinc-400">
          <li>· <code>GET /api/v1/tools</code> — welche Tools das Token darf und wann es abläuft</li>
          <li>· <code>GET /api/v1/openapi.json</code> — OpenAPI-3.1-Beschreibung (öffentlich), z.B. für Codegeneratoren</li>
        </ul>
      </div>
      <div>
        <p class="font-medium">Fehler</p>
        <p class="mb-1 text-zinc-400">Immer als <code>{`{ "error": { "code", "message", "details?" } }`}</code>.</p>
        <table class="w-full text-left text-xs">
          <tbody>
            {#each ERRORS as [status, code, text]}
              <tr class="border-t border-zinc-800 align-top">
                <td class="py-1 pr-2 font-mono text-zinc-300">{status}</td>
                <td class="py-1 pr-2 font-mono text-zinc-400">{code}</td>
                <td class="py-1 text-zinc-500">{text}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>

    {#if ops.length}
      <div class="sticky top-0 z-10 -mx-1 mb-4 bg-zinc-950/80 px-1 py-2 backdrop-blur">
        <input
          bind:value={filter}
          placeholder="Tool suchen…"
          class="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500"
        />
      </div>

      {#each categories as cat}
        {@const list = visible.filter((o) => o.category === cat)}
        {#if list.length}
          <h2 class="mb-2 mt-6 text-lg font-semibold tracking-tight">{cat}</h2>
          {#each list as op (op.name)}
            {@const props = Object.entries(op.schema.properties ?? {})}
            <details id={op.name} class="group mb-2 rounded-xl border border-zinc-800 bg-zinc-900/40">
              <summary class="flex cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-3">
                <span class="rounded bg-indigo-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-indigo-300">POST</span>
                <code class="text-sm">/{op.name}</code>
                <span class="rounded-full border border-zinc-800 px-1.5 text-[10px] {op.readOnly ? 'text-zinc-500' : 'text-amber-300/80'}">{op.readOnly ? "lesen" : "ändern"}</span>
                <span class="w-full text-xs text-zinc-500 group-open:hidden sm:w-auto sm:flex-1 sm:truncate">{op.description}</span>
              </summary>
              <div class="space-y-3 border-t border-zinc-800 px-4 py-3 text-sm">
                <p class="text-zinc-300">{op.description}</p>
                <p class="text-xs text-zinc-500">Scope: <code class="text-zinc-300">{op.name}</code></p>
                {#if props.length}
                  <table class="w-full text-left text-xs">
                    <thead class="text-zinc-500">
                      <tr><th class="pb-1 pr-2 font-normal">Feld</th><th class="pb-1 pr-2 font-normal">Typ</th><th class="pb-1 font-normal">Beschreibung</th></tr>
                    </thead>
                    <tbody>
                      {#each props as [key, s]}
                        <tr class="border-t border-zinc-800 align-top">
                          <td class="py-1 pr-2 font-mono text-zinc-300">
                            {key}{#if op.schema.required?.includes(key)}<span class="text-red-400" title="Pflichtfeld">*</span>{/if}
                          </td>
                          <td class="break-all py-1 pr-2 font-mono text-zinc-400">{typeLabel(s)}</td>
                          <td class="py-1 text-zinc-500">
                            {s.description ?? ""}
                            {#if constraints(s).length}<span class="block text-zinc-600">{constraints(s).join(" · ")}</span>{/if}
                          </td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                {:else}
                  <p class="text-xs text-zinc-500">Keine Argumente.</p>
                {/if}
                <pre class="overflow-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs">{curl(op)}</pre>
              </div>
            </details>
          {/each}
        {/if}
      {/each}
    {/if}
  </div>
</div>
