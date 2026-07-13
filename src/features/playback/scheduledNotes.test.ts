import { describe, expect, it } from "vitest";
import type { MidiNote } from "../../domain/midi/midiProject";
import { buildTempoMap } from "../../domain/midi/tempoMap";
import {
  AUDITION_SECONDS,
  buildAuditionNotes,
  buildScheduledNotes,
  filterNotesForPlaybackScope,
  waveformForVoice,
} from "./scheduledNotes";

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
    expect(scheduled[0].pitch).toBe(60);
  });

  it("derives the waveform from a voice's presentation key when given", () => {
    // voice-5 alone sounds as triangle; mapped to A's voice-1 it sounds as square.
    const mapped = buildScheduledNotes(
      [note({ voiceId: "voice-5" })],
      tempoMap,
      0,
      null,
      { type: "all" },
      new Map([["voice-5", "voice-1"]]),
    );
    expect(mapped[0].waveform).toBe(waveformForVoice("voice-1"));

    const unmapped = buildScheduledNotes([note({ voiceId: "voice-5" })], tempoMap, 0, null);
    expect(unmapped[0].waveform).toBe(waveformForVoice("voice-5"));
  });

  it("audition blips also honor the presentation key", () => {
    const blips = buildAuditionNotes(
      [note({ voiceId: "voice-5" })],
      new Map([["voice-5", "voice-1"]]),
    );
    expect(blips[0].waveform).toBe(waveformForVoice("voice-1"));
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
  it("scopes playback to selected notes", () => {
    const notes = [note({ id: "a" }), note({ id: "b", startTick: 480, endTick: 960 })];

    const scheduled = buildScheduledNotes(notes, tempoMap, 0, null, {
      type: "selected",
      noteIds: new Set(["b"]),
    });

    expect(scheduled.map((scheduledNote) => scheduledNote.id)).toEqual(["b"]);
  });

  it("scopes playback to the current voice before applying solo", () => {
    const notes = [
      note({ id: "a", voiceId: "voice-1" }),
      note({ id: "b", voiceId: "voice-2" }),
      note({ id: "c", voiceId: "voice-2" }),
    ];

    const scheduled = buildScheduledNotes(notes, tempoMap, 0, null, {
      type: "voice",
      voiceId: "voice-2",
    });

    expect(scheduled.map((scheduledNote) => scheduledNote.id)).toEqual(["b", "c"]);
  });

  it("scopes playback to changed notes", () => {
    const notes = [note({ id: "a" }), note({ id: "b" })];

    const scheduled = buildScheduledNotes(notes, tempoMap, 0, null, {
      type: "changed",
      noteIds: new Set(["a"]),
    });

    expect(scheduled.map((scheduledNote) => scheduledNote.id)).toEqual(["a"]);
  });

  it("scopes playback around the current flagged note window", () => {
    const notes = [
      note({ id: "before", startTick: 0, endTick: 120 }),
      note({ id: "anchor", startTick: 480, endTick: 600 }),
      note({ id: "near", startTick: 700, endTick: 820 }),
      note({ id: "after", startTick: 1200, endTick: 1320 }),
    ];

    const scheduled = buildScheduledNotes(notes, tempoMap, 0, null, {
      type: "around-note",
      noteId: "anchor",
      beforeTicks: 120,
      afterTicks: 240,
    });

    expect(scheduled.map((scheduledNote) => scheduledNote.id)).toEqual(["anchor", "near"]);
  });

  it("reports when solo removes every note from the selected scope", () => {
    const notes = [note({ id: "a", voiceId: "voice-1" })];

    const result = filterNotesForPlaybackScope(notes, 0, "voice-2", {
      type: "selected",
      noteIds: new Set(["a"]),
    });

    expect(result.notes).toHaveLength(0);
    expect(result.scopeMatchedCount).toBe(1);
    expect(result.emptyReason).toBe("No notes in scope for soloed voice.");
  });

  it("reports when the selected scope itself has no active notes", () => {
    const result = filterNotesForPlaybackScope([note({ id: "a" })], 0, null, {
      type: "selected",
      noteIds: new Set(["missing"]),
    });

    expect(result.emptyReason).toBe("No notes in playback scope.");
  });
});

describe("buildAuditionNotes", () => {
  it("builds short, quiet, immediate blips keeping each note's voice waveform", () => {
    const blips = buildAuditionNotes([
      note({ id: "a", voiceId: "voice-1", pitch: 60 }),
      note({ id: "b", voiceId: "voice-2", pitch: 64 }),
    ]);

    expect(blips).toHaveLength(2);
    expect(blips[0].id).toBe("audition-a");
    expect(blips[0].startSeconds).toBe(0);
    expect(blips[0].endSeconds).toBe(AUDITION_SECONDS);
    expect(blips[0].frequency).toBeCloseTo(261.63, 1);
    expect(blips[0].waveform).toBe("square");
    expect(blips[1].waveform).toBe("triangle");
  });

  it("plays quieter than real playback", () => {
    const [blip] = buildAuditionNotes([note()]);
    const [scheduled] = buildScheduledNotes([note()], tempoMap, 0, null);

    expect(blip.gain).toBeLessThan(scheduled.gain);
  });

  it("caps a dense chord instead of blasting every note", () => {
    const chord = Array.from({ length: 10 }, (_, index) =>
      note({ id: `n${index}`, pitch: 60 + index }),
    );

    expect(buildAuditionNotes(chord)).toHaveLength(6);
  });
});
