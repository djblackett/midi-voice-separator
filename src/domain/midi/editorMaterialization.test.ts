import { describe, expect, it } from "vitest";
import type { MidiProject } from "./midiProject";
import { materializeEditorProject } from "./editorMaterialization";

const project: MidiProject = {
  fileName: "song.mid",
  format: "single-track",
  ppq: 480,
  durationTicks: 960,
  trackCount: 1,
  notes: [
    {
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
    },
    {
      id: "b",
      voiceId: "voice-1",
      sourceTrackIndex: 0,
      channel: 0,
      pitch: 72,
      velocity: 100,
      startTick: 480,
      endTick: 960,
      durationTicks: 480,
      assignmentConfidence: 1,
      assignmentReason: "IMPORTED",
    },
  ],
  voices: [{ id: "voice-1", label: "Voice 1", noteCount: 2, lowestPitch: 60, highestPitch: 72 }],
  tempoChanges: [],
  timeSignatures: [],
  warnings: [],
  separationSummary: { meanConfidence: 1, lowConfidenceNoteCount: 0, voiceCount: 1 },
  strategySuggestion: { strategy: "BALANCED", reason: "Fixture" },
};

describe("materializeEditorProject", () => {
  it("returns null without a project", () => {
    expect(
      materializeEditorProject({
        project: null,
        voiceOverrides: {},
        voiceOrder: [],
        voiceLabels: {},
      }),
    ).toBeNull();
  });

  it("applies overrides and includes correction-only voices", () => {
    const materialized = materializeEditorProject({
      project,
      voiceOverrides: { b: "voice-2" },
      voiceOrder: ["voice-1", "voice-2", "stale-empty"],
      voiceLabels: { "voice-1": "Bass", "voice-2": "Lead" },
    });

    expect(materialized?.notes.map((note) => note.voiceId)).toEqual(["voice-1", "voice-2"]);
    expect(materialized?.voices).toEqual([
      { id: "voice-1", label: "Bass", noteCount: 1, lowestPitch: 60, highestPitch: 60 },
      { id: "voice-2", label: "Lead", noteCount: 1, lowestPitch: 72, highestPitch: 72 },
      { id: "stale-empty", label: "Voice 3", noteCount: 0, lowestPitch: 0, highestPitch: 0 },
    ]);
  });

  it("does not mutate the source project or correction state", () => {
    const overrides = { b: "voice-2" };
    const labels = { "voice-1": "Bass" };
    const materialized = materializeEditorProject({
      project,
      voiceOverrides: overrides,
      voiceOrder: ["voice-1", "voice-2"],
      voiceLabels: labels,
    });

    expect(materialized).not.toBe(project);
    expect(project.notes[1].voiceId).toBe("voice-1");
    expect(overrides).toEqual({ b: "voice-2" });
    expect(labels).toEqual({ "voice-1": "Bass" });
  });
});
