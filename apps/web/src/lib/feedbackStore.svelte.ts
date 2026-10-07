/**
 * Global state for the feedback wizard.
 *
 * Opening it takes the screenshot *first* and only then shows the dialog, so
 * the picture is of the page the user was looking at, not of the wizard. The
 * screenshot is only a candidate — it is sent only if the user includes it.
 *
 * Anything marked `data-feedback-ignore` (the "Screenshot wird erstellt…"
 * pill, the wizard itself) is left out of the capture.
 */

export interface Screenshot {
  /** As captured — "Zurücksetzen" in the cropper goes back to this. */
  original: string;
  /** What will be sent: the original or a crop of it (JPEG data URL). */
  current: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
}

/** Longest edge of a stored screenshot; keeps reports well under a megabyte. */
const MAX_EDGE = 1920;

let state = $state({
  open: false,
  capturing: false,
  screenshot: null as Screenshot | null,
  screenshotError: null as string | null,
});

export async function canvasToJpeg(canvas: HTMLCanvasElement): Promise<{ url: string; width: number; height: number }> {
  let { width, height } = canvas;
  let source = canvas;
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  if (scale < 1) {
    width = Math.round(width * scale);
    height = Math.round(height * scale);
    source = document.createElement("canvas");
    source.width = width;
    source.height = height;
    source.getContext("2d")!.drawImage(canvas, 0, 0, width, height);
  }
  return { url: source.toDataURL("image/jpeg", 0.85), width, height };
}

async function capture(): Promise<Screenshot> {
  // Lazy: the library is only needed when someone actually sends feedback.
  const { domToCanvas } = await import("modern-screenshot");
  const canvas = await domToCanvas(document.body, {
    width: window.innerWidth,
    height: window.innerHeight,
    scale: Math.min(window.devicePixelRatio || 1, 2),
    backgroundColor: getComputedStyle(document.body).backgroundColor,
    timeout: 8000,
    filter: (node) => !(node instanceof Element && node.hasAttribute("data-feedback-ignore")),
  });
  const { url, width, height } = await canvasToJpeg(canvas);
  return { original: url, current: url, width, height, originalWidth: width, originalHeight: height };
}

/** Two frames — enough for a just-closed menu to actually leave the screen. */
const nextPaint = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

export const feedback = {
  get open() { return state.open; },
  get capturing() { return state.capturing; },
  get screenshot() { return state.screenshot; },
  get screenshotError() { return state.screenshotError; },

  async start() {
    if (state.open || state.capturing) return;
    state.capturing = true;
    state.screenshot = null;
    state.screenshotError = null;
    await nextPaint();
    try {
      state.screenshot = await capture();
    } catch (e) {
      console.warn("[feedback] screenshot failed", e);
      state.screenshotError = "Screenshot konnte nicht erstellt werden.";
    } finally {
      state.capturing = false;
      state.open = true;
    }
  },

  /** New screenshot while the wizard is open — it is filtered out of the capture. */
  async retake() {
    if (state.capturing) return;
    state.capturing = true;
    try {
      state.screenshot = await capture();
      state.screenshotError = null;
    } catch (e) {
      console.warn("[feedback] screenshot failed", e);
      state.screenshotError = "Screenshot konnte nicht erstellt werden.";
    } finally {
      state.capturing = false;
    }
  },

  setCurrent(url: string, width: number, height: number) {
    if (!state.screenshot) return;
    state.screenshot = { ...state.screenshot, current: url, width, height };
  },

  resetCrop() {
    const s = state.screenshot;
    if (s) this.setCurrent(s.original, s.originalWidth, s.originalHeight);
  },

  close() {
    state.open = false;
    state.screenshot = null;
    state.screenshotError = null;
  },
};
