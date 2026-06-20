import { describe, expect, it } from "vitest";
import type { MidiNote } from "../../domain/midi/midiProject";
import { buildTempoMap } from "../../domain/midi/tempoMap";
import { buildScheduledNotes, waveformForVoice } from "./scheduledNotes";

function note(overrides: Partial<MidiNote> = {}): MidiNote {
  return {
    id: "a",
    voiceId: "voice-1",
    sourceTrackIndex: 0,
    channel: 0,
    pitch: 60,
    velocity: 100,
    startTick: 0,
    endTick: 480,
    durationTicks: 480,
    assignmentConfidence: 1,
    assignmentReason: "IMPORTED",
    ...overrides,
  };
}

const tempoMap = buildTempoMap([], 480); // 120 BPM: 480 ticks = 0.5s

describe("waveformForVoice", () => {
  it("cycles waveforms by the same voice index color-picking uses", () => {
    expect(waveformForVoice("voice-1")).toBe("square");
    expect(waveformForVoice("voice-2")).toBe("triangle");
    expect(waveformForVoice("voice-3")).toBe("sawtooth");
  });

  it("wraps around for voice ids beyond the waveform count", () => {
    expect(waveformForVoice("voice-4")).toBe("square");
  });
});

describe("buildScheduledNotes", () => {
  it("schedules a note starting at tick 0 with seconds relative to startTick 0", () => {
    const scheduled = buildScheduledNotes([note()], tempoMap, 0, null);

    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].startSeconds).toBeCloseTo(0, 5);
    expect(scheduled[0].endSeconds).toBeCloseTo(0.5, 5);
    expect(scheduled[0].frequency).toBeCloseTo(261.63, 1);
  });

  it("excludes a note that ends at or before the resume point", () => {
    const scheduled = buildScheduledNotes(
      [note({ startTick: 0, endTick: 480 })],
      tempoMap,
      480,
      null,
    );

    expect(scheduled).toHaveLength(0);
  });

  it("truncates a note already in progress at the resume point instead of skipping it", () => {
    const scheduled = buildScheduledNotes(
      [note({ startTick: 0, endTick: 960 })],
      tempoMap,
      480,
      null,
    );

    expect(scheduled).toHaveLength(1);
    // Starts immediately (offset 0 from the resume point), not at its
    // original tick, and ends 0.5s later (ticks 480-960 remaining).
    expect(scheduled[0].startSeconds).toBeCloseTo(0, 5);
    expect(scheduled[0].endSeconds).toBeCloseTo(0.5, 5);
  });

  it("offsets a note starting after the resume point relative to that point", () => {
    const scheduled = buildScheduledNotes(
      [note({ startTick: 960, endTick: 1440 })],
      tempoMap,
      480,
      null,
    );

    expect(scheduled[0].startSeconds).toBeCloseTo(0.5, 5);
    expect(scheduled[0].endSeconds).toBeCloseTo(1, 5);
  });

  it("only schedules the soloed voice when one is set", () => {
    const notes = [note({ id: "a", voiceId: "voice-1" }), note({ id: "b", voiceId: "voice-2" })];

    const scheduled = buildScheduledNotes(notes, tempoMap, 0, "voice-2");

    expect(scheduled.map((scheduledNote) => scheduledNote.id)).toEqual(["b"]);
  });

  it("schedules every voice when no solo is set", () => {
    const notes = [note({ id: "a", voiceId: "voice-1" }), note({ id: "b", voiceId: "voice-2" })];

    const scheduled = buildScheduledNotes(notes, tempoMap, 0, null);

    expect(scheduled.map((scheduledNote) => scheduledNote.id).sort()).toEqual(["a", "b"]);
  });

  it("assigns a waveform per note matching its voice", () => {
    const scheduled = buildScheduledNotes([note({ voiceId: "voice-2" })], tempoMap, 0, null);

    expect(scheduled[0].waveform).toBe("triangle");
  });
});
