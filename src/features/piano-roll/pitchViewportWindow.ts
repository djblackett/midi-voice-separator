export interface PitchViewportWindow {
  /** >= 1. 1 means fully zoomed out (the whole project's pitch span is visible). */
  zoomLevel: number;
  /** Lowest visible pitch of the window, before clamping to a valid range. */
  panPitch: number;
}

export interface PitchRange {
  lowestPitch: number;
  highestPitch: number;
}

export const MIN_PITCH_ZOOM_LEVEL = 1;
// Lower than the tick axis's MAX_ZOOM_LEVEL (64) — pitch spans are much
// smaller to begin with, so the same relative headroom would zoom into a
// fraction of a semitone.
export const MAX_PITCH_ZOOM_LEVEL = 16;

export function defaultPitchViewportWindow(): PitchViewportWindow {
  return { zoomLevel: MIN_PITCH_ZOOM_LEVEL, panPitch: 0 };
}

export function clampPitchZoomLevel(zoomLevel: number): number {
  return Math.min(MAX_PITCH_ZOOM_LEVEL, Math.max(MIN_PITCH_ZOOM_LEVEL, zoomLevel));
}

/**
 * Resolves a `PitchViewportWindow` (zoom level + raw pan position) against
 * a project's full pitch span (`{ lowestPitch, highestPitch }`, typically
 * the lowest/highest note pitch padded by a couple of semitones) into a
 * concrete, clamped pitch range — mirrors `visibleTickRange`, treating
 * `panPitch` as an absolute pitch (clamped to `fullSpan`, the way
 * `panTick` is an absolute tick clamped to `[0, durationTicks]`). Rounds
 * its bounds to integers since pitch is discrete and `drawPianoRoll`'s
 * per-semitone row loop needs integer-aligned bounds, unlike the
 * continuous tick axis.
 */
export function visiblePitchRange(fullSpan: PitchRange, window: PitchViewportWindow): PitchRange {
  const totalPitches = Math.max(1, fullSpan.highestPitch - fullSpan.lowestPitch + 1);
  const zoomLevel = clampPitchZoomLevel(window.zoomLevel);
  const windowPitches = totalPitches / zoomLevel;
  const maxLowestPitch = fullSpan.lowestPitch + totalPitches - windowPitches;
  const lowestPitch = Math.min(maxLowestPitch, Math.max(fullSpan.lowestPitch, window.panPitch));
  return {
    lowestPitch: Math.floor(lowestPitch),
    highestPitch: Math.ceil(lowestPitch + windowPitches - 1),
  };
}

/**
 * Zooms by `factor` (>1 zooms in, <1 zooms out) while keeping
 * `anchorPitch` (typically the pitch under the cursor) at the same
 * position on screen.
 */
export function zoomPitchAt(
  window: PitchViewportWindow,
  fullSpan: PitchRange,
  factor: number,
  anchorPitch: number,
): PitchViewportWindow {
  const currentRange = visiblePitchRange(fullSpan, window);
  const currentWindowPitches = currentRange.highestPitch - currentRange.lowestPitch + 1;
  const nextZoomLevel = clampPitchZoomLevel(window.zoomLevel * factor);
  const totalPitches = Math.max(1, fullSpan.highestPitch - fullSpan.lowestPitch + 1);
  const nextWindowPitches = totalPitches / nextZoomLevel;
  const anchorRatio =
    currentWindowPitches > 0 ? (anchorPitch - currentRange.lowestPitch) / currentWindowPitches : 0;

  return {
    zoomLevel: nextZoomLevel,
    panPitch: anchorPitch - anchorRatio * nextWindowPitches,
  };
}

export function panPitchBy(window: PitchViewportWindow, deltaPitches: number): PitchViewportWindow {
  return { ...window, panPitch: window.panPitch + deltaPitches };
}

export function panPitchTo(window: PitchViewportWindow, panPitch: number): PitchViewportWindow {
  return { ...window, panPitch };
}

/**
 * Pans (never zooms) so `targetLowestPitch`-`targetHighestPitch` is
 * visible within the current window, with a small margin — mirrors
 * `panToReveal`, used so a flagged note's pitch (review-mode Tab-stepping)
 * or the playhead's pitch can't end up vertically scrolled out of view
 * once vertical zoom exists.
 */
export function panPitchToReveal(
  window: PitchViewportWindow,
  fullSpan: PitchRange,
  target: PitchRange,
): PitchViewportWindow {
  const range = visiblePitchRange(fullSpan, window);
  const windowPitches = range.highestPitch - range.lowestPitch + 1;
  const margin = windowPitches * 0.1;

  if (
    target.lowestPitch >= range.lowestPitch + margin &&
    target.highestPitch <= range.highestPitch - margin
  ) {
    return window;
  }

  const targetCenter = (target.lowestPitch + target.highestPitch) / 2;
  return panPitchTo(window, targetCenter - windowPitches / 2);
}
