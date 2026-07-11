import { describe, expect, it } from "vitest";
import type { MidiNote, MidiProject, MidiVoice } from "../domain/midi/midiProject";
import type { EditorSnapshot } from "./editorHistory";
import { createNamedSnapshot, type NamedSnapshot, type RerunSettings } from "./editorSnapshots";
import {
  buildComparePreview,
  createCompareState,
  describeVoiceMatch,
  editorSnapshotFromCurrent,
  isEditingDisabledForCompare,
  mapSoloVoiceForPreview,
  updateCompareViewing,
  type CurrentEditorCompareState,
} from "./editorCompare";

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

function voice(id: string, label: string, noteCount = 1): MidiVoice {
  return { id, label, noteCount, lowestPitch: 60, highestPitch: 60 };
}

function project(notes: MidiNote[], voices: MidiVoice[]): MidiProject {
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
    strategySuggestion: { strategy: "BALANCED", reason: "fixture" },
  };
}

const rerunSettings: RerunSettings = {
  strategy: "BALANCED",
  assignmentMode: "GREEDY",
  maxVoiceCount: null,
};

function snapshot(
  idName: string,
  state: Partial<EditorSnapshot> & Pick<EditorSnapshot, "project">,
): NamedSnapshot {
  return {
    ...createNamedSnapshot(
      {
        voiceOverrides: {},
        voiceOrder: state.project?.voices.map((voiceItem) => voiceItem.id) ?? [],
        voiceLabels: {},
        rangeAssignedNoteIds: new Set(),
        ...state,
      },
      rerunSettings,
      "manual",
      idName,
      1000,
      {
        kind: "reassigned",
        strategy: rerunSettings.strategy,
        mode: rerunSettings.assignmentMode,
        maxVoiceCount: rerunSettings.maxVoiceCount,
        algorithmVersion: 1,
      },
    ),
    id: idName,
  };
}

describe("editor compare state", () => {
  it("disables editing only for B and diff views", () => {
    const compareState = createCompareState("current", "snapshot-a");

    expect(isEditingDisabledForCompare(null)).toBe(false);
    expect(isEditingDisabledForCompare(compareState)).toBe(false);
    expect(isEditingDisabledForCompare(updateCompareViewing(compareState, "B"))).toBe(true);
    expect(isEditingDisabledForCompare(updateCompareViewing(compareState, "diff"))).toBe(true);
  });

  it("materializes the B snapshot project without mutating the current editor project", () => {
    const currentProject = project(
      [note("n1", "voice-1"), note("n2", "voice-2")],
      [voice("voice-1", "Lead"), voice("voice-2", "Bass")],
    );
    const targetProject = project(
      [note("n1", "voice-9"), note("n2", "voice-8")],
      [voice("voice-9", "Lead preview"), voice("voice-8", "Bass preview")],
    );
    const target = snapshot("target", {
      project: targetProject,
      voiceOrder: ["voice-9", "voice-8"],
      voiceLabels: { "voice-9": "Lead preview", "voice-8": "Bass preview" },
    });
    const current: CurrentEditorCompareState = {
      project: currentProject,
      voiceOverrides: {},
      voiceOrder: ["voice-1", "voice-2"],
      voiceLabels: {},
      rangeAssignedNoteIds: new Set(),
      assignmentProvenance: {
        kind: "reassigned",
        strategy: rerunSettings.strategy,
        mode: rerunSettings.assignmentMode,
        maxVoiceCount: rerunSettings.maxVoiceCount,
        algorithmVersion: 1,
      },
    };

    const preview = buildComparePreview(
      updateCompareViewing(createCompareState("current", "target"), "B"),
      [target],
      current,
    );

    expect(preview.project?.notes.map((item) => item.voiceId)).toEqual(["voice-9", "voice-8"]);
    expect(current.project?.notes.map((item) => item.voiceId)).toEqual(["voice-1", "voice-2"]);
  });

  it("maps solo voice ids through matched voices for B preview", () => {
    const currentProject = project(
      [note("n1", "voice-1"), note("n2", "voice-2")],
      [voice("voice-1", "Lead"), voice("voice-2", "Bass")],
    );
    const targetProject = project(
      [note("n1", "voice-9"), note("n2", "voice-8")],
      [voice("voice-9", "Lead preview"), voice("voice-8", "Bass preview")],
    );
    const target = snapshot("target", {
      project: targetProject,
      voiceOrder: ["voice-9", "voice-8"],
    });
    const current: CurrentEditorCompareState = {
      project: currentProject,
      voiceOverrides: {},
      voiceOrder: ["voice-1", "voice-2"],
      voiceLabels: {},
      rangeAssignedNoteIds: new Set(),
      assignmentProvenance: {
        kind: "reassigned",
        strategy: rerunSettings.strategy,
        mode: rerunSettings.assignmentMode,
        maxVoiceCount: rerunSettings.maxVoiceCount,
        algorithmVersion: 1,
      },
    };

    const preview = buildComparePreview(
      updateCompareViewing(createCompareState("current", "target"), "B"),
      [target],
      current,
    );

    expect(mapSoloVoiceForPreview("voice-1", preview.matching)).toBe("voice-9");
    expect(mapSoloVoiceForPreview("missing", preview.matching)).toBeNull();
  });

  it("describes B voice correspondence from the matching", () => {
    const matching = {
      matched: [{ beforeVoiceId: "voice-1", afterVoiceId: "voice-9" }],
      addedVoiceIds: ["voice-8"],
      removedVoiceIds: [],
    };

    expect(describeVoiceMatch(voice("voice-9", "Lead preview"), matching)).toBe("Matches voice-1");
    expect(describeVoiceMatch(voice("voice-8", "New"), matching)).toBe("New in preview");
  });

  it("copies current editor state into an EditorSnapshot shape", () => {
    const rangeAssignedNoteIds = new Set(["n1"]);
    const copied = editorSnapshotFromCurrent({
      project: null,
      voiceOverrides: { n1: "voice-2" },
      voiceOrder: ["voice-1"],
      voiceLabels: { "voice-1": "Lead" },
      rangeAssignedNoteIds,
    });

    rangeAssignedNoteIds.add("n2");

    expect(copied.rangeAssignedNoteIds).toEqual(new Set(["n1"]));
    expect(copied.voiceOrder).toEqual(["voice-1"]);
  });
});
