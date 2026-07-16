import { describe, expect, it } from "vitest";
import type { CrossImportAssignmentDiff } from "../../domain/midi/crossImportDiff";
import type { MidiNote, MidiProject } from "../../domain/midi/midiProject";
import type { ComparisonWorkspace } from "../editorCompare";
import type { ReferenceDocument } from "../referenceDocument";
import {
  commitActive,
  createComparisonBranches,
  forkSideB,
  setActiveSide,
  type ComparisonBranches,
} from "./comparisonBranches";
import { createEditorBranch } from "./editorBranch";
import type { EditorDocument } from "./editorDocument";
import {
  presentationKeyForVoice,
  resolveComparisonProjection,
  singleLayoutSide,
} from "./comparisonProjection";

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
  return {
    kind: "editableSnapshot",
    targetSnapshotId: "snap",
    viewing: layout === "split" ? "A" : "A",
    layout,
  };
}

function referenceDocument(assignments: Record<string, string>): ReferenceDocument {
  const notes = Object.entries(assignments).map(([noteId, voiceId], index) =>
    note(noteId, voiceId, 72 + index),
  );
  return {
    documentId: "reference-1",
    sourcePath: "C:/music/reference.mid",
    importedAt: 1,
    project: project(notes),
    assignmentProvenance: { kind: "imported", algorithmVersion: 1 },
  };
}

function externalWorkspace(
  viewing: "current" | "reference" | "diff",
  layout: "single" | "split",
): ComparisonWorkspace {
  return {
    kind: "externalReference",
    referenceDocumentId: "reference-1",
    target: { branchId: "A", documentId: "A", revision: 0 },
    viewing,
    layout,
  };
}

function externalDiff(): CrossImportAssignmentDiff {
  return {
    comparable: true,
    referenceDocumentId: "reference-1",
    editableDocumentId: "A",
    matcher: {
      matcherVersion: 1,
      policy: "CROSS_IMPORT_V1",
      referenceCoverage: { total: 2, exact: 2, fuzzy: 0, ambiguous: 0, unmatched: 0 },
      editableCoverage: { total: 2, exact: 2, fuzzy: 0, ambiguous: 0, unmatched: 0 },
      exactPairCount: 2,
      fuzzyPairCount: 0,
    },
    trustedPairCoverage: { reference: 1, editable: 1 },
    changedPairs: [],
    matchedVoices: [
      {
        reference: { documentId: "reference-1", voiceId: "reference-lead" },
        editable: { documentId: "A", voiceId: "voice-1" },
        overlap: 1,
      },
    ],
    addedEditableVoices: [],
    removedReferenceVoices: [{ documentId: "reference-1", voiceId: "reference-only" }],
    ambiguous: [],
    unmatchedReference: [],
    unmatchedEditable: [],
  };
}

describe("resolveComparisonProjection", () => {
  it("renders only the active side in single layout but still resolves correspondence", () => {
    const projection = resolveComparisonProjection(branchesWithB("A"), workspace("single"));
    expect(projection.visibleSides).toEqual(["A"]);
    // Correspondence + B presentation keys are resolved whenever B exists, so
    // monitored playback can give a matched B voice its A partner's timbre.
    expect(projection.correspondence).not.toBeNull();
    expect(projection.sideB?.presentationKeyByVoiceId.get("voice-5")).toBe("voice-1");
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
    expect(projection.sideA.presentationKeyByVoiceId.get("voice-1")).toBe("voice-1");
    expect(projection.sideA.presentationKeyByVoiceId.get("voice-2")).toBe("voice-2");
  });

  it("keeps presentation keys stable when a selected B note changes voice", () => {
    const before = branchesWithB("B");
    const beforeProjection = resolveComparisonProjection(before, workspace("split"));
    const edited = commitActive(before, {
      kind: "assignNotes",
      noteIds: ["n1"],
      voiceId: "voice-6",
    });
    const afterProjection = resolveComparisonProjection(edited, workspace("split"));

    expect(beforeProjection.sideB?.presentationKeyByVoiceId.get("voice-6")).toBe("voice-2");
    expect(afterProjection.sideB?.presentationKeyByVoiceId.get("voice-6")).toBe("voice-2");
    expect(afterProjection.correspondence).toEqual(beforeProjection.correspondence);
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

  it("projects current and immutable reference panes in external single view", () => {
    const branches = createComparisonBranches(
      createEditorBranch("A", document("A", { n1: "voice-1", n2: "voice-2" })),
    );
    const reference = referenceDocument({ r1: "reference-lead", r2: "reference-only" });
    const current = resolveComparisonProjection(branches, externalWorkspace("current", "single"), {
      reference,
      diff: externalDiff(),
    });
    const referenceView = resolveComparisonProjection(
      branches,
      externalWorkspace("reference", "single"),
      { reference, diff: externalDiff() },
    );

    expect(current.visibleSides).toEqual(["A"]);
    expect(singleLayoutSide(current)).toBe(current.sideA);
    expect(referenceView.visibleSides).toEqual(["reference"]);
    expect(singleLayoutSide(referenceView)).toMatchObject({
      kind: "reference",
      side: "reference",
      editable: false,
      document: reference,
    });
  });

  it("projects a read-only reference beside its target and maps only trusted matched voices", () => {
    const branches = createComparisonBranches(
      createEditorBranch("A", document("A", { n1: "voice-1", n2: "voice-2" })),
    );
    const reference = referenceDocument({ r1: "reference-lead", r2: "reference-only" });
    const projection = resolveComparisonProjection(
      branches,
      externalWorkspace("current", "split"),
      { reference, diff: externalDiff() },
    );

    expect(projection.visibleSides).toEqual(["A", "reference"]);
    expect(projection.reference?.editable).toBe(false);
    expect(presentationKeyForVoice(projection.reference!, "reference-lead")).toBe("voice-1");
    expect(presentationKeyForVoice(projection.reference!, "reference-only")).toBe("voice-2");
    expect("revisionRef" in projection.reference!).toBe(false);
  });
});
