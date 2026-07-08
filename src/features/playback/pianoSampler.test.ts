import { describe, expect, it } from "vitest";
import { nearestSamplePitch, SAMPLE_PITCHES, sampleFileForPitch } from "./pianoSampler";

describe("SAMPLE_PITCHES", () => {
  it("covers the full piano range A0-C8 at minor-third spacing", () => {
    expect(SAMPLE_PITCHES[0]).toBe(21); // A0
    expect(SAMPLE_PITCHES[SAMPLE_PITCHES.length - 1]).toBe(108); // C8
    expect(SAMPLE_PITCHES).toHaveLength(30);
  });
});

describe("nearestSamplePitch", () => {
  it("returns a sampled pitch unchanged", () => {
    expect(nearestSamplePitch(21)).toBe(21);
    expect(nearestSamplePitch(60)).toBe(60); // C4 is a sampled pitch
    expect(nearestSamplePitch(108)).toBe(108);
  });

  it("picks the closest sample for in-between pitches", () => {
    expect(nearestSamplePitch(61)).toBe(60); // C#4 -> C4 (1 semitone)
    expect(nearestSamplePitch(62)).toBe(63); // D4 -> D#4 (1 semitone)
  });

  it("never needs to shift by more than 1.5 semitones inside the range", () => {
    for (let pitch = 21; pitch <= 108; pitch++) {
      expect(Math.abs(nearestSamplePitch(pitch) - pitch)).toBeLessThanOrEqual(1.5);
    }
  });

  it("clamps pitches outside the sampled range to the nearest end", () => {
    expect(nearestSamplePitch(0)).toBe(21);
    expect(nearestSamplePitch(127)).toBe(108);
  });
});

describe("sampleFileForPitch", () => {
  it("names files with the sharp spelling and octave the sample set uses", () => {
    expect(sampleFileForPitch(21)).toBe("A0.mp3");
    expect(sampleFileForPitch(27)).toBe("Ds1.mp3");
    expect(sampleFileForPitch(66)).toBe("Fs4.mp3");
    expect(sampleFileForPitch(108)).toBe("C8.mp3");
  });

  it("rejects a pitch that is not one of the sampled pitches", () => {
    expect(() => sampleFileForPitch(22)).toThrow();
  });

  it("produces a valid file name for every sampled pitch", () => {
    for (const samplePitch of SAMPLE_PITCHES) {
      expect(sampleFileForPitch(samplePitch)).toMatch(/^(A|C|Ds|Fs)[0-8]\.mp3$/);
    }
  });
});
