import { describe, expect, it } from "vitest";
import type { MidiNote, MidiProject } from "../../domain/midi/midiProject";
import type { ComparisonWorkspace } from "../editorCompare";
import {
  createComparisonBranches,
  forkSideB,
  setActiveSide,
  type ComparisonBranches,
} from "./comparisonBranches";
import { createEditorBranch } from "./editorBranch";
import type { EditorDocument } from "./editorDocument";
import { resolveComparisonProjection, singleLayoutSide } from "./comparisonProjection";

function note(id: string, voiceId: string, pitch: number): MidiNote {
  return {
    id,
    voiceId,
    sourceTrackIndex: 0,
    channel: 0,
    pitch,
    velocity: 100,
    startTick: 0,
    endTick: 120,
    durationTicks: 120,
    assignmentConfidence: 1,
    assignmentReason: "IMPORTED",
  };
}

function project(notes: MidiNote[]): MidiProject {
  const voiceIds = [...new Set(notes.map((entry) => entry.voiceId))];
  return {
    fileName: "fixture.mid",
    format: "parallel",
    ppq: 480,
    durationTicks: 960,
    trackCount: 1,
    voices: voiceIds.map((id) => ({
      id,
      label: id,
      noteCount: 1,
      lowestPitch: 60,
      highestPitch: 60,
    })),
    notes,
    tempoChanges: [],
    timeSignatures: [],
    warnings: [],
    separationSummary: {
      meanConfidence: 1,
      lowConfidenceNoteCount: 0,
      voiceCount: voiceIds.length,
    },
    strategySuggestion: { strategy: "BALANCED", reason: "fixture" },
  };
}

function document(id: string, assignments: Record<string, string>): EditorDocument {
  const notes = Object.entries(assignments).map(([noteId, voiceId], index) =>
    note(noteId, voiceId, 60 + index),
  );
  return {
    documentId: id,
    revision: 0,
    project: project(notes),
    voiceOverrides: {},
    voiceOrder: [...new Set(notes.map((entry) => entry.voiceId))],
    voiceLabels: {},
    rangeAssignedNoteIds: new Set(),
    assignmentProvenance: { kind: "imported", algorithmVersion: 1 },
  };
}

function branchesWithB(activeSide: "A" | "B" = "A"): ComparisonBranches {
  const start = createComparisonBranches(
    createEditorBranch("A", document("A", { n1: "voice-1", n2: "voice-2" })),
  );
  // B has the same notes under different voice ids -- a divergent side to match.
  const forked = forkSideB(start, document("B", { n1: "voice-5", n2: "voice-6" }), "snap");
  return activeSide === "B" ? setActiveSide(forked, "B") : forked;
}

function workspace(layout: "single" | "split"): ComparisonWorkspace {
  return { targetSnapshotId: "snap", viewing: layout === "split" ? "A" : "A", layout };
}

describe("resolveComparisonProjection", () => {
  it("shows only the active side and no correspondence in single layout", () => {
    const projection = resolveComparisonProjection(branchesWithB("A"), workspace("single"));
    expect(projection.visibleSides).toEqual(["A"]);
    expect(projection.correspondence).toBeNull();
    expect(projection.sideB?.presentationKeyByVoiceId.size).toBe(0);
    expect(singleLayoutSide(projection).side).toBe("A");
  });

  it("shows both sides and derives correspondence-based B presentation keys in split", () => {
    const projection = resolveComparisonProjection(branchesWithB("A"), workspace("split"));
    expect(projection.visibleSides).toEqual(["A", "B"]);
    expect(projection.correspondence?.matched).toEqual([
      { aVoiceId: "voice-1", bVoiceId: "voice-5", overlap: 1 },
      { aVoiceId: "voice-2", bVoiceId: "voice-6", overlap: 1 },
    ]);
    // B's matched voices reuse their A partners' presentation keys; A stays canonical.
    expect(projection.sideB?.presentationKeyByVoiceId.get("voice-5")).toBe("voice-1");
    expect(projection.sideB?.presentationKeyByVoiceId.get("voice-6")).toBe("voice-2");
    expect(projection.sideA.presentationKeyByVoiceId.size).toBe(0);
  });

  it("marks only the active side editable", () => {
    const onA = resolveComparisonProjection(branchesWithB("A"), workspace("split"));
    expect(onA.sideA.editable).toBe(true);
    expect(onA.sideB?.editable).toBe(false);

    const onB = resolveComparisonProjection(branchesWithB("B"), workspace("split"));
    expect(onB.sideA.editable).toBe(false);
    expect(onB.sideB?.editable).toBe(true);
  });

  it("has no side B and renders only A when no comparison branch is forked", () => {
    const branches = createComparisonBranches(
      createEditorBranch("A", document("A", { n1: "voice-1" })),
    );
    const projection = resolveComparisonProjection(branches, null);
    expect(projection.sideB).toBeNull();
    expect(projection.visibleSides).toEqual(["A"]);
    expect(singleLayoutSide(projection)).toBe(projection.sideA);
  });
});
