import { describe, expect, it } from "vitest";
import type { MidiProject } from "./midiProject";
import { applyVoiceOverrides, voiceIdForNumber } from "./voiceAssignments";

const project: MidiProject = {
  fileName: "song.mid",
  format: "parallel",
  ppq: 480,
  durationTicks: 960,
  trackCount: 1,
  voices: [
    { id: "voice-1", label: "Voice 1", noteCount: 2, lowestPitch: 60, highestPitch: 64 },
    { id: "voice-2", label: "Voice 2", noteCount: 1, lowestPitch: 72, highestPitch: 72 },
  ],
  notes: [
    {
      id: "note-1",
      voiceId: "voice-1",
      sourceTrackIndex: 0,
      channel: 0,
      pitch: 60,
      velocity: 100,
      startTick: 0,
      endTick: 240,
      durationTicks: 240,
      assignmentConfidence: 1,
      assignmentReason: "IMPORTED",
    },
    {
      id: "note-2",
      voiceId: "voice-1",
      sourceTrackIndex: 0,
      channel: 0,
      pitch: 64,
      velocity: 100,
      startTick: 240,
      endTick: 480,
      durationTicks: 240,
      assignmentConfidence: 1,
      assignmentReason: "IMPORTED",
    },
    {
      id: "note-3",
      voiceId: "voice-2",
      sourceTrackIndex: 0,
      channel: 0,
      pitch: 72,
      velocity: 100,
      startTick: 480,
      endTick: 720,
      durationTicks: 240,
      assignmentConfidence: 1,
      assignmentReason: "IMPORTED",
    },
  ],
  tempoChanges: [],
  timeSignatures: [],
  warnings: [],
  separationSummary: { meanConfidence: 1, lowConfidenceNoteCount: 0, voiceCount: 2 },
  strategySuggestion: { strategy: "BALANCED", reason: "test fixture" },
};

describe("applyVoiceOverrides", () => {
  it("returns a derived project without mutating the imported project", () => {
    const derived = applyVoiceOverrides(project, { "note-2": "voice-2" });

    expect(project.notes[1].voiceId).toBe("voice-1");
    expect(derived.notes[1].voiceId).toBe("voice-2");
  });

  it("leaves notes without an override unchanged", () => {
    const derived = applyVoiceOverrides(project, { "note-2": "voice-2" });

    expect(derived.notes[0].voiceId).toBe("voice-1");
    expect(derived.notes[2].voiceId).toBe("voice-2");
  });
});

describe("voiceIdForNumber", () => {
  it("maps one-based shortcut numbers to existing voice IDs", () => {
    expect(voiceIdForNumber(project, 1)).toBe("voice-1");
    expect(voiceIdForNumber(project, 2)).toBe("voice-2");
  });

  it("returns null for missing voices", () => {
    expect(voiceIdForNumber(project, 9)).toBeNull();
    expect(voiceIdForNumber(null, 1)).toBeNull();
  });
});
