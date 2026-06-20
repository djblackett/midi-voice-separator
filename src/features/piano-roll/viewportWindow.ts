export interface ViewportWindow {
  /** >= 1. 1 means fully zoomed out (the whole project is visible). */
  zoomLevel: number;
  /** Start tick of the visible window, before clamping to a valid range. */
  panTick: number;
}

export interface TickRange {
  startTick: number;
  endTick: number;
}

export const MIN_ZOOM_LEVEL = 1;
export const MAX_ZOOM_LEVEL = 64;

export function defaultViewportWindow(): ViewportWindow {
  return { zoomLevel: MIN_ZOOM_LEVEL, panTick: 0 };
}

export function clampZoomLevel(zoomLevel: number): number {
  return Math.min(MAX_ZOOM_LEVEL, Math.max(MIN_ZOOM_LEVEL, zoomLevel));
}

/**
 * Resolves a `ViewportWindow` (zoom level + raw pan position) against an
 * actual project duration into a concrete, clamped tick range — the only
 * thing `drawPianoRoll`/`hitTest` need, since both already work in terms
 * of an arbitrary `{ startTick, endTick }` window rather than assuming it
 * spans the whole project.
 */
export function visibleTickRange(durationTicks: number, window: ViewportWindow): TickRange {
  const totalTicks = Math.max(1, durationTicks);
  const zoomLevel = clampZoomLevel(window.zoomLevel);
  const windowTicks = totalTicks / zoomLevel;
  const maxStartTick = Math.max(0, totalTicks - windowTicks);
  const startTick = Math.min(maxStartTick, Math.max(0, window.panTick));
  return { startTick, endTick: startTick + windowTicks };
}

/**
 * Zooms by `factor` (>1 zooms in, <1 zooms out) while keeping `anchorTick`
 * (typically the tick under the cursor) at the same position on screen.
 */
export function zoomAt(
  window: ViewportWindow,
  durationTicks: number,
  factor: number,
  anchorTick: number,
): ViewportWindow {
  const currentRange = visibleTickRange(durationTicks, window);
  const currentWindowTicks = currentRange.endTick - currentRange.startTick;
  const nextZoomLevel = clampZoomLevel(window.zoomLevel * factor);
  const nextWindowTicks = Math.max(1, durationTicks) / nextZoomLevel;
  const anchorRatio =
    currentWindowTicks > 0 ? (anchorTick - currentRange.startTick) / currentWindowTicks : 0;

  return {
    zoomLevel: nextZoomLevel,
    panTick: anchorTick - anchorRatio * nextWindowTicks,
  };
}

export function panBy(window: ViewportWindow, deltaTicks: number): ViewportWindow {
  return { ...window, panTick: window.panTick + deltaTicks };
}

export function panTo(window: ViewportWindow, panTick: number): ViewportWindow {
  return { ...window, panTick };
}

/**
 * Pans (never zooms) so `targetStartTick`-`targetEndTick` is visible within
 * the current window, with a small margin, leaving the window already
 * comfortably showing the target untouched. Used to bring a
 * keyboard-selected note (e.g. via review-mode Tab-stepping) into view
 * without fighting the user's chosen zoom level.
 */
export function panToReveal(
  window: ViewportWindow,
  durationTicks: number,
  target: TickRange,
): ViewportWindow {
  const range = visibleTickRange(durationTicks, window);
  const windowTicks = range.endTick - range.startTick;
  const margin = windowTicks * 0.1;

  if (target.startTick >= range.startTick + margin && target.endTick <= range.endTick - margin) {
    return window;
  }

  const targetCenter = (target.startTick + target.endTick) / 2;
  return panTo(window, targetCenter - windowTicks / 2);
}
