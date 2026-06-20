import { describe, expect, it } from "vitest";
import type { MidiNote } from "./midiProject";
import {
  buildDefaultPitchMarkers,
  buildDefaultVoiceRangeRules,
  buildVoiceOverridesFromRangeRules,
  clampMidiPitch,
  describePitchRangeRule,
  noteMatchesVoiceRangeRule,
  type PitchMarker,
} from "./rangeRules";

const markers: PitchMarker[] = [
  { id: "marker-1", label: "Marker 1", pitch: 72 },
  { id: "marker-2", label: "Marker 2", pitch: 60 },
];

function note(id: string, pitch: number): MidiNote {
  return {
    id,
    pitch,
    voiceId: "voice-original",
    sourceTrackIndex: 0,
    channel: 0,
    velocity: 100,
    startTick: 0,
    endTick: 120,
    durationTicks: 120,
    assignmentConfidence: 1,
    assignmentReason: "IMPORTED",
  };
}

describe("clampMidiPitch", () => {
  it("rounds finite pitches into the MIDI pitch range", () => {
    expect(clampMidiPitch(60.4)).toBe(60);
    expect(clampMidiPitch(-4)).toBe(0);
    expect(clampMidiPitch(130)).toBe(127);
  });

  it("handles non-finite input without returning NaN", () => {
    expect(clampMidiPitch(Number.NaN)).toBe(0);
  });
});

describe("buildDefaultPitchMarkers", () => {
  it("places two markers within the loaded pitch span", () => {
    expect(buildDefaultPitchMarkers([note("low", 48), note("high", 84)])).toEqual([
      { id: "marker-1", label: "Marker 1", pitch: 72 },
      { id: "marker-2", label: "Marker 2", pitch: 60 },
    ]);
  });

  it("falls back to a useful octave split when there are no notes", () => {
    expect(buildDefaultPitchMarkers([])).toEqual([
      { id: "marker-1", label: "Marker 1", pitch: 72 },
      { id: "marker-2", label: "Marker 2", pitch: 60 },
    ]);
  });
});

describe("buildDefaultVoiceRangeRules", () => {
  it("maps the first three voices to above, between, and below ranges", () => {
    expect(buildDefaultVoiceRangeRules(["voice-1", "voice-2", "voice-3"])).toMatchObject([
      { boundary: "above", voiceId: "voice-1", upperMarkerId: "marker-1" },
      {
        boundary: "between",
        voiceId: "voice-2",
        lowerMarkerId: "marker-2",
        upperMarkerId: "marker-1",
      },
      { boundary: "below", voiceId: "voice-3", lowerMarkerId: "marker-2" },
    ]);
  });

  it("omits rules when there are fewer voices", () => {
    expect(buildDefaultVoiceRangeRules(["voice-1"])).toHaveLength(1);
  });
});

describe("noteMatchesVoiceRangeRule", () => {
  const [aboveRule, betweenRule, belowRule] = buildDefaultVoiceRangeRules([
    "voice-1",
    "voice-2",
    "voice-3",
  ]);

  it("matches notes strictly above the upper marker", () => {
    expect(noteMatchesVoiceRangeRule(note("a", 73), aboveRule, markers)).toBe(true);
    expect(noteMatchesVoiceRangeRule(note("b", 72), aboveRule, markers)).toBe(false);
  });

  it("matches notes above the lower marker through the upper marker", () => {
    expect(noteMatchesVoiceRangeRule(note("a", 61), betweenRule, markers)).toBe(true);
    expect(noteMatchesVoiceRangeRule(note("b", 72), betweenRule, markers)).toBe(true);
    expect(noteMatchesVoiceRangeRule(note("c", 60), betweenRule, markers)).toBe(false);
  });

  it("matches notes at or below the lower marker", () => {
    expect(noteMatchesVoiceRangeRule(note("a", 60), belowRule, markers)).toBe(true);
    expect(noteMatchesVoiceRangeRule(note("b", 61), belowRule, markers)).toBe(false);
  });

  it("handles reversed marker pitches for between ranges", () => {
    expect(
      noteMatchesVoiceRangeRule(note("a", 68), betweenRule, [
        { id: "marker-1", label: "Marker 1", pitch: 60 },
        { id: "marker-2", label: "Marker 2", pitch: 72 },
      ]),
    ).toBe(true);
  });
});

describe("buildVoiceOverridesFromRangeRules", () => {
  it("builds an override patch from the first matching range rule", () => {
    const rules = buildDefaultVoiceRangeRules(["voice-1", "voice-2", "voice-3"]);

    expect(
      buildVoiceOverridesFromRangeRules(
        [note("high", 80), note("middle", 64), note("low", 48)],
        markers,
        rules,
      ),
    ).toEqual({
      high: "voice-1",
      middle: "voice-2",
      low: "voice-3",
    });
  });
});

describe("describePitchRangeRule", () => {
  it("formats each default range in pitch terms", () => {
    const rules = buildDefaultVoiceRangeRules(["voice-1", "voice-2", "voice-3"]);

    expect(rules.map((rule) => describePitchRangeRule(rule, markers))).toEqual([
      "Pitch > 72",
      "60 < pitch <= 72",
      "Pitch <= 60",
    ]);
  });
});
