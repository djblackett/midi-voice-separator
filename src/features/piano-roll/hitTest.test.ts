import { describe, expect, it } from "vitest";
import type { MidiProject } from "../../domain/midi/midiProject";
import type { PianoRollViewport } from "../../domain/midi/viewport";
import { hitTestPianoRollNote } from "./hitTest";

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
    },
  ],
  tempoChanges: [],
  timeSignatures: [],
  warnings: [],
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
