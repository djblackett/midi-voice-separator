import { describe, expect, it } from "vitest";
import type { MidiNote, MidiProject, MidiVoice } from "../domain/midi/midiProject";
import type { EditorSnapshot } from "./editorHistory";
import {
  createNamedSnapshot,
  materializeAssignments,
  resetSnapshotIdSequence,
  restoreEditorState,
  type RerunSettings,
} from "./editorSnapshots";

function note(id: string, voiceId: string, overrides: Partial<MidiNote> = {}): MidiNote {
  return {
    id,
    voiceId,
    sourceTrackIndex: 0,
    channel: 0,
    pitch: 60,
    velocity: 100,
    startTick: 0,
    endTick: 120,
    durationTicks: 120,
    assignmentConfidence: 1,
    assignmentReason: "CLOSEST_PITCH",
    ...overrides,
  };
}

function voice(id: string, label: string): MidiVoice {
  return { id, label, noteCount: 1, lowestPitch: 60, highestPitch: 60 };
}

function project(
  notes: MidiNote[],
  voices: MidiVoice[] = [voice("voice-1", "Voice 1")],
): MidiProject {
  return {
    fileName: "fixture.mid",
    format: "parallel",
    ppq: 480,
    durationTicks: 960,
    trackCount: 1,
    voices,
    notes,
    tempoChanges: [],
    timeSignatures: [],
    warnings: [],
    separationSummary: { meanConfidence: 1, lowConfidenceNoteCount: 0, voiceCount: voices.length },
    strategySuggestion: { strategy: "REGISTER_PRIORITY", reason: "fixture" },
  };
}

const rerunSettings: RerunSettings = {
  strategy: "BALANCED",
  assignmentMode: "GREEDY",
  maxVoiceCount: null,
};

function editorState(overrides: Partial<EditorSnapshot> = {}): EditorSnapshot {
  return {
    project: project([note("a", "voice-1")]),
    voiceOverrides: {},
    voiceOrder: ["voice-1"],
    voiceLabels: {},
    rangeAssignedNoteIds: new Set(),
    ...overrides,
  };
}

describe("createNamedSnapshot", () => {
  it("captures all five EditorSnapshot fields plus the rerun settings triple", () => {
    resetSnapshotIdSequence();
    const state = editorState({
      voiceOverrides: { a: "voice-2" },
      voiceOrder: ["voice-1", "voice-2"],
      voiceLabels: { "voice-2": "Lead" },
      rangeAssignedNoteIds: new Set(["a"]),
    });

    const snapshot = createNamedSnapshot(state, rerunSettings, "manual", "My snapshot", 1000);

    expect(snapshot).toEqual({
      id: "snapshot-1",
      name: "My snapshot",
      createdAt: 1000,
      source: "manual",
      rerunSettings,
      state,
    });
  });

  it("generates a source-derived default name when none is given", () => {
    resetSnapshotIdSequence();
    const snapshot = createNamedSnapshot(editorState(), rerunSettings, "import", undefined, 0);

    expect(snapshot.name).toContain("Import");
  });

  it("assigns unique, incrementing ids across snapshots", () => {
    resetSnapshotIdSequence();
    const first = createNamedSnapshot(editorState(), rerunSettings, "manual");
    const second = createNamedSnapshot(editorState(), rerunSettings, "manual");

    expect(first.id).not.toBe(second.id);
  });
});

describe("restoreEditorState", () => {
  it("round-trips every field, including rangeAssignedNoteIds", () => {
    const state = editorState({
      voiceOverrides: { a: "voice-2" },
      rangeAssignedNoteIds: new Set(["a", "b"]),
    });
    const snapshot = createNamedSnapshot(state, rerunSettings, "manual");

    expect(restoreEditorState(snapshot)).toEqual(state);
  });

  it("restores the full pre-rerun project, not just overrides/order/labels", () => {
    // Regression guard for the documented Phase-7 half-revert bug: a
    // snapshot taken before "Re-run separation" must restore the old
    // `project` object wholesale, since project.notes[].voiceId (not just
    // voiceOverrides) changes on a re-run.
    const beforeProject = project([note("a", "voice-1")]);
    const beforeState = editorState({ project: beforeProject, voiceOverrides: {} });
    const snapshot = createNamedSnapshot(beforeState, rerunSettings, "before-rerun");

    const restored = restoreEditorState(snapshot);

    expect(restored.project).toBe(beforeProject);
    expect(restored.project?.notes[0].voiceId).toBe("voice-1");
  });
});

describe("materializeAssignments", () => {
  it("uses the override when one exists, otherwise the note's own voiceId", () => {
    const proj = project([note("a", "voice-1"), note("b", "voice-1")]);

    const assignments = materializeAssignments(proj, { a: "voice-2" });

    expect(assignments.get("a")).toBe("voice-2");
    expect(assignments.get("b")).toBe("voice-1");
  });

  it("matches the same composition applyVoiceOverrides uses", () => {
    const proj = project([note("a", "voice-1")]);

    const assignments = materializeAssignments(proj, {});

    expect(assignments.get("a")).toBe("voice-1");
  });
});
