<script lang="ts">
  import { canvasToJpeg } from "$lib/feedbackStore.svelte";

  /**
   * Rechteck auf dem Screenshot aufziehen, verschieben, an den Ecken ziehen.
   * Geschnitten wird immer aus dem Original, damit man den Ausschnitt nach
   * dem Übernehmen noch einmal ändern kann, ohne Qualität zu verlieren.
   */
  interface Props {
    src: string;
    onapply: (url: string, width: number, height: number) => void;
    oncancel: () => void;
  }
  let { src, onapply, oncancel }: Props = $props();

  /** Auswahl in Anteilen des Bildes (0…1), unabhängig von der Anzeigegröße. */
  type Rect = { x: number; y: number; w: number; h: number };
  let sel = $state<Rect | null>(null);
  let box: HTMLDivElement;
  let busy = $state(false);

  type Drag =
    | { kind: "new"; x0: number; y0: number }
    | { kind: "move"; dx: number; dy: number }
    | { kind: "corner"; ax: number; ay: number };
  let drag: Drag | null = null;

  const clamp = (v: number) => Math.min(1, Math.max(0, v));

  function point(e: PointerEvent) {
    const r = box.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
  }

  function rectFrom(ax: number, ay: number, bx: number, by: number): Rect {
    return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
  }

  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    box.setPointerCapture(e.pointerId);
    const p = point(e);
    const corner = (e.target as HTMLElement).dataset.corner;
    if (sel && corner) {
      // The corner opposite the grabbed one stays put.
      const ax = corner.includes("l") ? sel.x + sel.w : sel.x;
      const ay = corner.includes("t") ? sel.y + sel.h : sel.y;
      drag = { kind: "corner", ax, ay };
    } else if (sel && p.x >= sel.x && p.x <= sel.x + sel.w && p.y >= sel.y && p.y <= sel.y + sel.h) {
      drag = { kind: "move", dx: p.x - sel.x, dy: p.y - sel.y };
    } else {
      drag = { kind: "new", x0: p.x, y0: p.y };
      sel = { x: p.x, y: p.y, w: 0, h: 0 };
    }
  }

  function move(e: PointerEvent) {
    if (!drag || !sel) return;
    const p = point(e);
    if (drag.kind === "new") sel = rectFrom(drag.x0, drag.y0, p.x, p.y);
    else if (drag.kind === "corner") sel = rectFrom(drag.ax, drag.ay, p.x, p.y);
    else {
      sel = {
        ...sel,
        x: Math.min(1 - sel.w, Math.max(0, p.x - drag.dx)),
        y: Math.min(1 - sel.h, Math.max(0, p.y - drag.dy)),
      };
    }
  }

  function up() {
    drag = null;
    // A click without dragging leaves a zero-size box — treat as "no selection".
    if (sel && (sel.w < 0.01 || sel.h < 0.01)) sel = null;
  }

  async function apply() {
    if (!sel) return;
    busy = true;
    try {
      const img = new Image();
      img.src = src;
      await img.decode();
      const sx = Math.round(sel.x * img.naturalWidth);
      const sy = Math.round(sel.y * img.naturalHeight);
      const sw = Math.max(1, Math.round(sel.w * img.naturalWidth));
      const sh = Math.max(1, Math.round(sel.h * img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = sw;
      canvas.height = sh;
      canvas.getContext("2d")!.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      const out = await canvasToJpeg(canvas);
      onapply(out.url, out.width, out.height);
    } finally {
      busy = false;
    }
  }

  const pct = (v: number) => `${(v * 100).toFixed(3)}%`;
</script>

<div class="space-y-3">
  <p class="text-xs text-zinc-500">Ziehe ein Rechteck über den Bereich, der mitgeschickt werden soll. Ecken zum Anpassen, Innenfläche zum Verschieben.</p>
  <div
    bind:this={box}
    class="relative cursor-crosshair touch-none select-none overflow-hidden rounded-lg border border-zinc-800"
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    role="application"
    aria-label="Ausschnitt wählen"
  >
    <img {src} alt="Screenshot" class="pointer-events-none block w-full" draggable="false" />
    {#if sel}
      <!-- Dim everything outside the selection with one giant box-shadow. -->
      <div
        class="absolute cursor-move border-2 border-indigo-400"
        style="left: {pct(sel.x)}; top: {pct(sel.y)}; width: {pct(sel.w)}; height: {pct(sel.h)}; box-shadow: 0 0 0 9999px rgb(0 0 0 / 0.55);"
      >
        {#each ["tl", "tr", "bl", "br"] as c}
          <span
            data-corner={c}
            class="absolute h-3 w-3 rounded-sm border border-white bg-indigo-500
              {c.includes('t') ? '-top-1.5' : '-bottom-1.5'} {c.includes('l') ? '-left-1.5' : '-right-1.5'}
              {c === 'tr' || c === 'bl' ? 'cursor-nesw-resize' : 'cursor-nwse-resize'}"
          ></span>
        {/each}
      </div>
    {/if}
  </div>
  <div class="flex justify-end gap-2">
    <button type="button" onclick={oncancel} class="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-100">Abbrechen</button>
    <button
      type="button"
      onclick={apply}
      disabled={!sel || busy}
      class="rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
    >{busy ? "Bitte warten…" : "Ausschnitt übernehmen"}</button>
  </div>
</div>
