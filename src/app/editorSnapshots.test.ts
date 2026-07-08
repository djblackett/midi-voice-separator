import { describe, expect, it } from "vitest";
import type { MidiNote, MidiProject, MidiVoice } from "../domain/midi/midiProject";
import type { EditorSnapshot } from "./editorHistory";
import {
  appendSnapshot,
  createNamedSnapshot,
  formatRerunSettings,
  formatSnapshotSource,
  formatSnapshotSummary,
  formatSnapshotTimestamp,
  materializeAssignments,
  resetSnapshotIdSequence,
  restoreEditorState,
  type NamedSnapshot,
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

describe("appendSnapshot", () => {
  function snapshotOf(source: NamedSnapshot["source"]): NamedSnapshot {
    return createNamedSnapshot(editorState(), rerunSettings, source);
  }

  it("keeps every import/manual/restore snapshot regardless of count", () => {
    resetSnapshotIdSequence();
    let snapshots: NamedSnapshot[] = [];
    for (let index = 0; index < 8; index += 1) {
      snapshots = appendSnapshot(snapshots, snapshotOf("manual"));
    }

    expect(snapshots).toHaveLength(8);
  });

  it("caps before-rerun and after-rerun entries independently, dropping the oldest", () => {
    resetSnapshotIdSequence();
    let snapshots: NamedSnapshot[] = [];
    for (let index = 0; index < 7; index += 1) {
      snapshots = appendSnapshot(snapshots, snapshotOf("before-rerun"));
      snapshots = appendSnapshot(snapshots, snapshotOf("after-rerun"));
    }

    const beforeRerun = snapshots.filter((entry) => entry.source === "before-rerun");
    const afterRerun = snapshots.filter((entry) => entry.source === "after-rerun");
    expect(beforeRerun).toHaveLength(5);
    expect(afterRerun).toHaveLength(5);
    // Oldest three of each (ids 1-3 for before, 2-4 wouldn't apply here since
    // interleaved) are dropped; the most recent five survive.
    expect(beforeRerun.map((entry) => entry.id)).toEqual([
      "snapshot-5",
      "snapshot-7",
      "snapshot-9",
      "snapshot-11",
      "snapshot-13",
    ]);
  });

  it("does not prune auto-rerun snapshots below the cap", () => {
    resetSnapshotIdSequence();
    let snapshots: NamedSnapshot[] = [];
    snapshots = appendSnapshot(snapshots, snapshotOf("before-rerun"));
    snapshots = appendSnapshot(snapshots, snapshotOf("after-rerun"));

    expect(snapshots).toHaveLength(2);
  });
});

describe("formatSnapshotSource", () => {
  it("labels every source distinctly", () => {
    expect(formatSnapshotSource("import")).toBe("Import");
    expect(formatSnapshotSource("manual")).toBe("Manual snapshot");
    expect(formatSnapshotSource("before-rerun")).toBe("Before rerun");
    expect(formatSnapshotSource("after-rerun")).toBe("After rerun");
    expect(formatSnapshotSource("restore")).toBe("Restore point");
  });
});

describe("formatRerunSettings", () => {
  it("formats strategy, search mode, and an explicit voice cap", () => {
    expect(
      formatRerunSettings({
        strategy: "CHANNEL_PRIORITY",
        assignmentMode: "GLOBAL",
        maxVoiceCount: 4,
      }),
    ).toBe("Channel priority · Global · max 4 voices");
  });

  it("shows 'auto voices' when no cap was set", () => {
    expect(formatRerunSettings(rerunSettings)).toBe("Balanced · Greedy · auto voices");
  });
});

describe("formatSnapshotSummary", () => {
  it("joins source, timestamp, and rerun settings into one line", () => {
    resetSnapshotIdSequence();
    const snapshot = createNamedSnapshot(editorState(), rerunSettings, "before-rerun", "x", 0);

    expect(formatSnapshotSummary(snapshot)).toBe(
      `${formatSnapshotSource("before-rerun")} · ${formatSnapshotTimestamp(0)} · ${formatRerunSettings(rerunSettings)}`,
    );
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
