import { describe, expect, it } from "vitest";
import { pitchToY, tickToX, xToTick, yToPitch } from "./coordinates";
import type { PianoRollViewport } from "../../domain/midi/viewport";

const viewport: PianoRollViewport = {
  width: 1000,
  height: 600,
  startTick: 100,
  endTick: 1100,
  lowestPitch: 48,
  highestPitch: 72,
};

describe("piano roll coordinates", () => {
  it("converts ticks to x coordinates", () => {
    expect(tickToX(600, viewport)).toBe(500);
  });

  it("converts x coordinates to ticks", () => {
    expect(xToTick(500, viewport)).toBe(600);
  });

  it("converts pitches to y coordinates", () => {
    expect(pitchToY(72, viewport)).toBe(0);
    expect(pitchToY(48, viewport)).toBeCloseTo(576);
  });

  it("converts y coordinates to pitches", () => {
    expect(yToPitch(0, viewport)).toBe(72);
    expect(yToPitch(599, viewport)).toBe(47);
  });

  it("handles empty viewport spans", () => {
    const emptyViewport = {
      width: 0,
      height: 0,
      startTick: 0,
      endTick: 0,
      lowestPitch: 60,
      highestPitch: 60,
    };

    expect(tickToX(0, emptyViewport)).toBe(0);
    expect(xToTick(0, emptyViewport)).toBe(0);
    expect(pitchToY(60, emptyViewport)).toBe(0);
    expect(yToPitch(0, emptyViewport)).toBe(60);
  });
});
