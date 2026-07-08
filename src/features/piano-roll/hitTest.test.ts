import { describe, expect, it } from "vitest";
import type { MidiProject } from "../../domain/midi/midiProject";
import type { PianoRollViewport } from "../../domain/midi/viewport";
import { hitTestPianoRollNote, hitTestPianoRollNotesInRect } from "./hitTest";

const viewport: PianoRollViewport = {
  width: 1056,
  height: 260,
  startTick: 0,
  endTick: 1000,
  lowestPitch: 60,
  highestPitch: 64,
};

const project: MidiProject = {
  fileName: "test.mid",
  format: "single-track",
  ppq: 480,
  durationTicks: 1000,
  trackCount: 1,
  voices: [{ id: "voice-1", label: "Voice 1", noteCount: 2, lowestPitch: 60, highestPitch: 64 }],
  notes: [
    {
      id: "long",
      voiceId: "voice-1",
      sourceTrackIndex: 0,
      channel: 0,
      pitch: 60,
      velocity: 80,
      startTick: 0,
      endTick: 800,
      durationTicks: 800,
      assignmentConfidence: 1,
      assignmentReason: "IMPORTED",
    },
    {
      id: "short",
      voiceId: "voice-1",
      sourceTrackIndex: 0,
      channel: 0,
      pitch: 64,
      velocity: 90,
      startTick: 100,
      endTick: 200,
      durationTicks: 100,
      assignmentConfidence: 1,
      assignmentReason: "IMPORTED",
    },
  ],
  tempoChanges: [],
  timeSignatures: [],
  warnings: [],
  separationSummary: { meanConfidence: 1, lowConfidenceNoteCount: 0, voiceCount: 1 },
  strategySuggestion: { strategy: "BALANCED", reason: "test fixture" },
};

describe("hitTestPianoRollNote", () => {
  it("returns null for the piano-key label area", () => {
    expect(hitTestPianoRollNote({ x: 20, y: 20 }, project, viewport)).toBeNull();
  });

  it("finds a note at a canvas point", () => {
    expect(hitTestPianoRollNote({ x: 180, y: 2 }, project, viewport)?.id).toBe("short");
  });

  it("returns null when no note contains the point", () => {
    expect(hitTestPianoRollNote({ x: 980, y: 2 }, project, viewport)).toBeNull();
  });

  it("returns null without a project", () => {
    expect(hitTestPianoRollNote({ x: 180, y: 2 }, null, viewport)).toBeNull();
  });
});

describe("hitTestPianoRollNotesInRect", () => {
  it("finds every note intersecting the rectangle", () => {
    const notes = hitTestPianoRollNotesInRect(
      { x0: 60, y0: 0, x1: 1056, y1: 260 },
      project,
      viewport,
    );

    expect(notes.map((note) => note.id).sort()).toEqual(["long", "short"]);
  });

  it("excludes notes outside the rectangle", () => {
    const notes = hitTestPianoRollNotesInRect(
      { x0: 900, y0: 0, x1: 1056, y1: 10 },
      project,
      viewport,
    );

    expect(notes).toEqual([]);
  });

  it("normalizes inverted drag coordinates", () => {
    const notes = hitTestPianoRollNotesInRect(
      { x0: 1056, y0: 260, x1: 60, y1: 0 },
      project,
      viewport,
    );

    expect(notes.map((note) => note.id).sort()).toEqual(["long", "short"]);
  });

  it("returns an empty array without a project", () => {
    expect(
      hitTestPianoRollNotesInRect({ x0: 60, y0: 0, x1: 1056, y1: 260 }, null, viewport),
    ).toEqual([]);
  });

  it("returns an empty array entirely within the piano-key label area", () => {
    expect(
      hitTestPianoRollNotesInRect({ x0: 0, y0: 0, x1: 40, y1: 260 }, project, viewport),
    ).toEqual([]);
  });
});
