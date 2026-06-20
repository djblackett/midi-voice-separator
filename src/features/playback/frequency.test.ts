import { describe, expect, it } from "vitest";
import { midiPitchToFrequency } from "./frequency";

describe("midiPitchToFrequency", () => {
  it("maps A4 (pitch 69) to 440 Hz", () => {
    expect(midiPitchToFrequency(69)).toBeCloseTo(440, 5);
  });

  it("doubles frequency one octave up", () => {
    expect(midiPitchToFrequency(81)).toBeCloseTo(880, 5);
  });

  it("halves frequency one octave down", () => {
    expect(midiPitchToFrequency(57)).toBeCloseTo(220, 5);
  });

  it("maps middle C (pitch 60) to approximately 261.63 Hz", () => {
    expect(midiPitchToFrequency(60)).toBeCloseTo(261.63, 1);
  });
});
