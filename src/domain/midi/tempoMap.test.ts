import { describe, expect, it } from "vitest";
import { buildTempoMap, secondsToTick, tickToSeconds } from "./tempoMap";

describe("buildTempoMap / tickToSeconds", () => {
  it("defaults to 120 BPM when there are no tempo changes", () => {
    const tempoMap = buildTempoMap([], 480);

    // At 120 BPM, one quarter note (480 ticks at ppq 480) is 0.5s.
    expect(tickToSeconds(tempoMap, 480)).toBeCloseTo(0.5, 5);
    expect(tickToSeconds(tempoMap, 960)).toBeCloseTo(1, 5);
  });

  it("uses an explicit tempo change at tick 0 instead of the default", () => {
    // 500000 -> 120bpm baseline; 1000000 microseconds/quarter = 60 BPM.
    const tempoMap = buildTempoMap([{ tick: 0, microsecondsPerQuarter: 1_000_000 }], 480);

    expect(tickToSeconds(tempoMap, 480)).toBeCloseTo(1, 5);
  });

  it("shifts seconds-per-tick after a mid-track tempo change", () => {
    const tempoMap = buildTempoMap(
      [
        { tick: 0, microsecondsPerQuarter: 500_000 }, // 120 BPM
        { tick: 960, microsecondsPerQuarter: 1_000_000 }, // 60 BPM, starting at tick 960
      ],
      480,
    );

    // First two quarters at 120 BPM: 0.5s each -> tick 960 is at 1s.
    expect(tickToSeconds(tempoMap, 960)).toBeCloseTo(1, 5);
    // Third quarter at 60 BPM takes 1s -> tick 1440 is at 2s.
    expect(tickToSeconds(tempoMap, 1440)).toBeCloseTo(2, 5);
  });

  it("treats a tempo change before tick 0 as not needing a default segment", () => {
    const tempoMap = buildTempoMap([{ tick: 0, microsecondsPerQuarter: 500_000 }], 480);

    expect(tempoMap.segments).toHaveLength(1);
  });

  it("sorts out-of-order tempo changes before building segments", () => {
    const tempoMap = buildTempoMap(
      [
        { tick: 960, microsecondsPerQuarter: 1_000_000 },
        { tick: 0, microsecondsPerQuarter: 500_000 },
      ],
      480,
    );

    expect(tickToSeconds(tempoMap, 960)).toBeCloseTo(1, 5);
  });
});

describe("secondsToTick", () => {
  it("round-trips with tickToSeconds at a constant tempo", () => {
    const tempoMap = buildTempoMap([], 480);

    const seconds = tickToSeconds(tempoMap, 720);
    expect(secondsToTick(tempoMap, seconds)).toBeCloseTo(720, 5);
  });

  it("round-trips across a mid-track tempo change", () => {
    const tempoMap = buildTempoMap(
      [
        { tick: 0, microsecondsPerQuarter: 500_000 },
        { tick: 960, microsecondsPerQuarter: 1_000_000 },
      ],
      480,
    );

    const seconds = tickToSeconds(tempoMap, 1200);
    expect(secondsToTick(tempoMap, seconds)).toBeCloseTo(1200, 5);
  });

  it("returns tick 0 for a negative or zero time", () => {
    const tempoMap = buildTempoMap([], 480);

    expect(secondsToTick(tempoMap, 0)).toBeCloseTo(0, 5);
  });
});
