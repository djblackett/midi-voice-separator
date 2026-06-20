import { describe, expect, it } from "vitest";
import {
  clampZoomLevel,
  defaultViewportWindow,
  panBy,
  panTo,
  panToReveal,
  visibleTickRange,
  zoomAt,
  MAX_ZOOM_LEVEL,
  MIN_ZOOM_LEVEL,
} from "./viewportWindow";

describe("clampZoomLevel", () => {
  it("clamps below the minimum", () => {
    expect(clampZoomLevel(0)).toBe(MIN_ZOOM_LEVEL);
  });

  it("clamps above the maximum", () => {
    expect(clampZoomLevel(1000)).toBe(MAX_ZOOM_LEVEL);
  });

  it("leaves an in-range value unchanged", () => {
    expect(clampZoomLevel(4)).toBe(4);
  });
});

describe("visibleTickRange", () => {
  it("spans the whole project at the default (fully zoomed-out) window", () => {
    expect(visibleTickRange(960, defaultViewportWindow())).toEqual({
      startTick: 0,
      endTick: 960,
    });
  });

  it("shrinks the window proportionally to the zoom level", () => {
    expect(visibleTickRange(960, { zoomLevel: 4, panTick: 0 })).toEqual({
      startTick: 0,
      endTick: 240,
    });
  });

  it("clamps panTick so the window never starts before tick 0", () => {
    expect(visibleTickRange(960, { zoomLevel: 4, panTick: -500 })).toEqual({
      startTick: 0,
      endTick: 240,
    });
  });

  it("clamps panTick so the window never extends past the project duration", () => {
    expect(visibleTickRange(960, { zoomLevel: 4, panTick: 10_000 })).toEqual({
      startTick: 720,
      endTick: 960,
    });
  });

  it("treats a zero-duration project as having at least one tick", () => {
    expect(visibleTickRange(0, defaultViewportWindow())).toEqual({ startTick: 0, endTick: 1 });
  });
});

describe("zoomAt", () => {
  it("keeps the anchor tick at the same relative position when zooming in", () => {
    const zoomedIn = zoomAt(defaultViewportWindow(), 960, 2, 480);

    const range = visibleTickRange(960, zoomedIn);
    expect(range.endTick - range.startTick).toBeCloseTo(480, 5);
    // The anchor (tick 480) was at the midpoint of the full 0-960 window
    // (ratio 0.5); it should still be at the midpoint of the new window.
    const anchorRatio = (480 - range.startTick) / (range.endTick - range.startTick);
    expect(anchorRatio).toBeCloseTo(0.5, 5);
  });

  it("zooming back out by the inverse factor returns to the original window", () => {
    const zoomedIn = zoomAt(defaultViewportWindow(), 960, 4, 200);
    const zoomedOut = zoomAt(zoomedIn, 960, 0.25, 200);

    expect(visibleTickRange(960, zoomedOut)).toEqual(
      visibleTickRange(960, defaultViewportWindow()),
    );
  });

  it("never zooms in past MAX_ZOOM_LEVEL", () => {
    const zoomed = zoomAt({ zoomLevel: MAX_ZOOM_LEVEL, panTick: 0 }, 960, 10, 0);

    expect(zoomed.zoomLevel).toBe(MAX_ZOOM_LEVEL);
  });
});

describe("panBy / panTo", () => {
  it("panBy shifts panTick by the given delta", () => {
    expect(panBy({ zoomLevel: 2, panTick: 100 }, 50)).toEqual({ zoomLevel: 2, panTick: 150 });
  });

  it("panTo sets panTick directly", () => {
    expect(panTo({ zoomLevel: 2, panTick: 100 }, 300)).toEqual({ zoomLevel: 2, panTick: 300 });
  });
});

describe("panToReveal", () => {
  it("does not change the window when the target is already comfortably visible", () => {
    const window = { zoomLevel: 1, panTick: 0 };

    expect(panToReveal(window, 960, { startTick: 400, endTick: 440 })).toBe(window);
  });

  it("pans to center the target when it falls outside the visible window", () => {
    const window = { zoomLevel: 4, panTick: 0 }; // visible: 0-240

    const revealed = panToReveal(window, 960, { startTick: 700, endTick: 720 });

    const range = visibleTickRange(960, revealed);
    expect(range.startTick).toBeLessThanOrEqual(710);
    expect(range.endTick).toBeGreaterThanOrEqual(710);
  });

  it("never changes the zoom level, only the pan position", () => {
    const window = { zoomLevel: 4, panTick: 0 };

    const revealed = panToReveal(window, 960, { startTick: 700, endTick: 720 });

    expect(revealed.zoomLevel).toBe(4);
  });

  it("pans to reveal a target near the start of a zoomed-in, scrolled-forward window", () => {
    const window = { zoomLevel: 4, panTick: 700 }; // visible: 700-940

    const revealed = panToReveal(window, 960, { startTick: 10, endTick: 30 });

    const range = visibleTickRange(960, revealed);
    expect(range.startTick).toBeLessThanOrEqual(20);
    expect(range.endTick).toBeGreaterThanOrEqual(20);
  });
});
