import { describe, expect, it } from "vitest";
import {
  clampLaneViewport,
  defaultLaneViewportWindow,
  laneViewportAnchor,
  panLaneViewportBy,
  reconcileLaneViewport,
  resolveLaneViewport,
  revealLaneVoices,
  type LaneViewportContext,
} from "./laneViewport";

function context(voiceIds: readonly string[], viewportHeight = 108): LaneViewportContext {
  return { voiceIds, viewportHeight };
}

const manyVoices = Array.from({ length: 10 }, (_, index) => `voice-${index + 1}`);

describe("lane viewport resolution", () => {
  it("resolves empty and single-voice layouts without scrolling", () => {
    expect(resolveLaneViewport(defaultLaneViewportWindow(), 0, 180)).toEqual({
      laneHeight: 180,
      contentHeight: 0,
      scrollTopPx: 0,
      maxScrollTopPx: 0,
    });
    expect(resolveLaneViewport({ scrollTopPx: 40 }, 1, 180)).toEqual({
      laneHeight: 180,
      contentHeight: 180,
      scrollTopPx: 0,
      maxScrollTopPx: 0,
    });
  });

  it("uses the minimum lane height and resolves the maximum scroll offset", () => {
    expect(resolveLaneViewport({ scrollTopPx: 999 }, 10, 108)).toEqual({
      laneHeight: 36,
      contentHeight: 360,
      scrollTopPx: 252,
      maxScrollTopPx: 252,
    });
  });

  it("clamps negative, non-finite, and oversized offsets", () => {
    expect(clampLaneViewport({ scrollTopPx: -10 }, 10, 108)).toEqual({
      scrollTopPx: 0,
    });
    expect(clampLaneViewport({ scrollTopPx: Number.NaN }, 10, 108)).toEqual({
      scrollTopPx: 0,
    });
    expect(clampLaneViewport({ scrollTopPx: Number.POSITIVE_INFINITY }, 10, 108)).toEqual({
      scrollTopPx: 0,
    });
    expect(clampLaneViewport({ scrollTopPx: 999 }, 10, 108)).toEqual({
      scrollTopPx: 252,
    });
  });
});

describe("lane viewport navigation", () => {
  const laneContext = context(manyVoices);

  it("pans in pixels and clamps in both directions", () => {
    const stable = { scrollTopPx: 72 };

    expect(panLaneViewportBy(stable, 0, laneContext)).toBe(stable);
    expect(panLaneViewportBy({ scrollTopPx: 72 }, 25, laneContext)).toEqual({
      scrollTopPx: 97,
    });
    expect(panLaneViewportBy({ scrollTopPx: 20 }, -100, laneContext)).toEqual({
      scrollTopPx: 0,
    });
    expect(panLaneViewportBy({ scrollTopPx: 240 }, 100, laneContext)).toEqual({
      scrollTopPx: 252,
    });
  });

  it("reveals the first, middle, and final rows with a margin", () => {
    expect(revealLaneVoices({ scrollTopPx: 120 }, ["voice-1"], laneContext)).toEqual({
      scrollTopPx: 0,
    });
    expect(revealLaneVoices({ scrollTopPx: 0 }, ["voice-6"], laneContext)).toEqual({
      scrollTopPx: 116,
    });
    expect(revealLaneVoices({ scrollTopPx: 0 }, ["voice-10"], laneContext)).toEqual({
      scrollTopPx: 252,
    });
  });

  it("keeps an already comfortable row stable and ignores missing voices", () => {
    const current = { scrollTopPx: 72 };

    expect(revealLaneVoices(current, ["voice-4"], laneContext)).toBe(current);
    expect(revealLaneVoices(current, ["missing"], laneContext)).toBe(current);
  });

  it("reveals the extent of multiple target rows", () => {
    expect(revealLaneVoices({ scrollTopPx: 0 }, ["voice-4", "voice-6"], laneContext)).toEqual({
      scrollTopPx: 116,
    });
  });
});

describe("lane viewport reconciliation", () => {
  it("preserves the anchor offset where possible and clamps after resize", () => {
    const previous = context(manyVoices, 108);
    const next = context(manyVoices, 180);

    expect(reconcileLaneViewport({ scrollTopPx: 90 }, previous, next)).toEqual({
      scrollTopPx: 90,
    });

    const fourVoices = ["a", "b", "c", "d"];
    expect(
      reconcileLaneViewport(
        { scrollTopPx: 75 },
        context(fourVoices, 100),
        context(fourVoices, 200),
      ),
    ).toEqual({ scrollTopPx: 0 });
  });

  it("preserves the same semantic anchor when voices reorder", () => {
    expect(
      reconcileLaneViewport(
        { scrollTopPx: 90 },
        context(["a", "b", "c", "d", "e"], 72),
        context(["c", "a", "b", "d", "e"], 72),
      ),
    ).toEqual({ scrollTopPx: 18 });
  });

  it("preserves object identity when reconciliation does not move", () => {
    const current = { scrollTopPx: 72 };
    const atTop = defaultLaneViewportWindow();
    const unchangedContext = context(manyVoices);

    expect(reconcileLaneViewport(current, unchangedContext, unchangedContext)).toBe(current);
    expect(reconcileLaneViewport(atTop, context(["a"], 72), context([], 72))).toBe(atTop);
  });

  it("uses the nearest following survivor when the anchor is removed", () => {
    expect(
      reconcileLaneViewport(
        { scrollTopPx: 72 },
        context(["a", "b", "c", "d", "e"], 72),
        context(["a", "b", "d", "e"], 72),
      ),
    ).toEqual({ scrollTopPx: 72 });
  });

  it("resets when no voices survive or either side is empty", () => {
    expect(
      reconcileLaneViewport(
        { scrollTopPx: 72 },
        context(["a", "b", "c", "d"], 72),
        context(["w", "x", "y", "z"], 72),
      ),
    ).toEqual({ scrollTopPx: 0 });
    expect(
      reconcileLaneViewport({ scrollTopPx: 72 }, context(["a", "b"], 72), context([], 72)),
    ).toEqual({ scrollTopPx: 0 });
  });
});

describe("lane viewport anchor", () => {
  const laneContext = context(manyVoices);

  it("returns the voice intersecting the top edge, including row boundaries", () => {
    expect(laneViewportAnchor({ scrollTopPx: 0 }, laneContext)).toBe("voice-1");
    expect(laneViewportAnchor({ scrollTopPx: 35.9 }, laneContext)).toBe("voice-1");
    expect(laneViewportAnchor({ scrollTopPx: 36 }, laneContext)).toBe("voice-2");
    expect(laneViewportAnchor({ scrollTopPx: 252 }, laneContext)).toBe("voice-8");
  });

  it("returns null for an empty voice order", () => {
    expect(laneViewportAnchor({ scrollTopPx: 0 }, context([]))).toBeNull();
  });
});
