import { describe, expect, it } from "vitest";
import {
  clampPitchZoomLevel,
  defaultPitchViewportWindow,
  panPitchBy,
  panPitchTo,
  panPitchToReveal,
  visiblePitchRange,
  zoomPitchAt,
  MAX_PITCH_ZOOM_LEVEL,
  MIN_PITCH_ZOOM_LEVEL,
} from "./pitchViewportWindow";

const fullSpan = { lowestPitch: 40, highestPitch: 79 }; // 40 pitches

describe("clampPitchZoomLevel", () => {
  it("clamps below the minimum", () => {
    expect(clampPitchZoomLevel(0)).toBe(MIN_PITCH_ZOOM_LEVEL);
  });

  it("clamps above the maximum", () => {
    expect(clampPitchZoomLevel(1000)).toBe(MAX_PITCH_ZOOM_LEVEL);
  });

  it("leaves an in-range value unchanged", () => {
    expect(clampPitchZoomLevel(4)).toBe(4);
  });
});

describe("visiblePitchRange", () => {
  it("spans the whole project at the default (fully zoomed-out) window", () => {
    expect(visiblePitchRange(fullSpan, defaultPitchViewportWindow())).toEqual({
      lowestPitch: 40,
      highestPitch: 79,
    });
  });

  it("shrinks the window proportionally to the zoom level", () => {
    expect(visiblePitchRange(fullSpan, { zoomLevel: 4, panPitch: 40 })).toEqual({
      lowestPitch: 40,
      highestPitch: 49,
    });
  });

  it("clamps panPitch so the window never starts below the full span's lowest pitch", () => {
    expect(visiblePitchRange(fullSpan, { zoomLevel: 4, panPitch: -500 })).toEqual({
      lowestPitch: 40,
      highestPitch: 49,
    });
  });

  it("clamps panPitch so the window never extends past the full span's highest pitch", () => {
    expect(visiblePitchRange(fullSpan, { zoomLevel: 4, panPitch: 1000 })).toEqual({
      lowestPitch: 70,
      highestPitch: 79,
    });
  });

  it("treats a single-pitch span as having at least one pitch", () => {
    expect(
      visiblePitchRange({ lowestPitch: 60, highestPitch: 60 }, defaultPitchViewportWindow()),
    ).toEqual({
      lowestPitch: 60,
      highestPitch: 60,
    });
  });
});

describe("zoomPitchAt", () => {
  it("keeps the anchor pitch at the same relative position when zooming in", () => {
    const zoomedIn = zoomPitchAt(defaultPitchViewportWindow(), fullSpan, 2, 60);

    const range = visiblePitchRange(fullSpan, zoomedIn);
    expect(range.highestPitch - range.lowestPitch + 1).toBeCloseTo(20, 0);
    // The anchor (pitch 60) was at the midpoint of the full 40-79 window
    // (ratio 0.5); it should still be roughly at the midpoint.
    const anchorRatio = (60 - range.lowestPitch) / (range.highestPitch - range.lowestPitch + 1);
    expect(anchorRatio).toBeCloseTo(0.5, 1);
  });

  it("never zooms in past MAX_PITCH_ZOOM_LEVEL", () => {
    const zoomed = zoomPitchAt({ zoomLevel: MAX_PITCH_ZOOM_LEVEL, panPitch: 40 }, fullSpan, 10, 40);

    expect(zoomed.zoomLevel).toBe(MAX_PITCH_ZOOM_LEVEL);
  });
});

describe("panPitchBy / panPitchTo", () => {
  it("panPitchBy shifts panPitch by the given delta", () => {
    expect(panPitchBy({ zoomLevel: 2, panPitch: 50 }, 5)).toEqual({ zoomLevel: 2, panPitch: 55 });
  });

  it("panPitchTo sets panPitch directly", () => {
    expect(panPitchTo({ zoomLevel: 2, panPitch: 50 }, 60)).toEqual({ zoomLevel: 2, panPitch: 60 });
  });
});

describe("panPitchToReveal", () => {
  it("does not change the window when the target is already comfortably visible", () => {
    const window = { zoomLevel: 1, panPitch: 40 };

    expect(panPitchToReveal(window, fullSpan, { lowestPitch: 55, highestPitch: 58 })).toBe(window);
  });

  it("pans to reveal a target that falls outside the visible window", () => {
    const window = { zoomLevel: 4, panPitch: 40 }; // visible: 40-49

    const revealed = panPitchToReveal(window, fullSpan, { lowestPitch: 70, highestPitch: 72 });

    const range = visiblePitchRange(fullSpan, revealed);
    expect(range.lowestPitch).toBeLessThanOrEqual(71);
    expect(range.highestPitch).toBeGreaterThanOrEqual(71);
  });

  it("never changes the zoom level, only the pan position", () => {
    const window = { zoomLevel: 4, panPitch: 40 };

    const revealed = panPitchToReveal(window, fullSpan, { lowestPitch: 70, highestPitch: 72 });

    expect(revealed.zoomLevel).toBe(4);
  });
});
