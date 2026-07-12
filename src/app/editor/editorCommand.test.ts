import { describe, expect, it } from "vitest";
import type { MidiNote, MidiProject } from "../../domain/midi/midiProject";
import { applyEditorCommand, type EditorCommand } from "./editorCommand";
import type { AssignmentProvenance, EditorDocument } from "./editorDocument";

function note(id: string, voiceId: string): MidiNote {
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
    assignmentReason: "IMPORTED",
  };
}

function project(notes: MidiNote[] = [note("a", "voice-1"), note("b", "voice-2")]): MidiProject {
  return {
    fileName: "fixture.mid",
    format: "MIDI",
    ppq: 480,
    durationTicks: 120,
    trackCount: 1,
    voices: [
      { id: "voice-1", label: "Voice 1", noteCount: 1, lowestPitch: 60, highestPitch: 60 },
      { id: "voice-2", label: "Voice 2", noteCount: 1, lowestPitch: 60, highestPitch: 60 },
    ],
    notes,
    tempoChanges: [],
    timeSignatures: [],
    warnings: [],
    separationSummary: { meanConfidence: 1, lowConfidenceNoteCount: 0, voiceCount: 2 },
    strategySuggestion: { strategy: "BALANCED", reason: "fixture" },
  };
}

const imported: AssignmentProvenance = { kind: "imported", algorithmVersion: 1 };

function document(overrides: Record<string, string> = {}): EditorDocument {
  return {
    documentId: "document-a",
    revision: 4,
    project: project(),
    voiceOverrides: overrides,
    voiceOrder: ["voice-1", "voice-2"],
    voiceLabels: { "voice-1": "Lead" },
    rangeAssignedNoteIds: new Set(),
    assignmentProvenance: imported,
  };
}

function expectSingleRevisionStep(before: EditorDocument, after: EditorDocument): void {
  expect(after).not.toBe(before);
  expect(after.documentId).toBe(before.documentId);
  expect(after.revision).toBe(before.revision + 1);
}

describe("applyEditorCommand", () => {
  it("assigns notes as a hand correction and clears their range ownership", () => {
    const before = { ...document(), rangeAssignedNoteIds: new Set(["a"]) };

    const after = applyEditorCommand(before, {
      kind: "assignNotes",
      noteIds: ["a", "missing"],
      voiceId: "voice-2",
    });

    expectSingleRevisionStep(before, after);
    expect(after.voiceOverrides).toEqual({ a: "voice-2", missing: "voice-2" });
    expect(after.rangeAssignedNoteIds).toEqual(new Set());
    expect(before.voiceOverrides).toEqual({});
    expect(before.rangeAssignedNoteIds).toEqual(new Set(["a"]));
  });

  it("uses the same hand-correction semantics for paint notes", () => {
    const before = { ...document({ a: "voice-1" }), rangeAssignedNoteIds: new Set(["a"]) };

    const after = applyEditorCommand(before, {
      kind: "paintNotes",
      noteIds: ["a"],
      voiceId: "voice-2",
    });

    expectSingleRevisionStep(before, after);
    expect(after.voiceOverrides).toEqual({ a: "voice-2" });
    expect(after.rangeAssignedNoteIds).toEqual(new Set());
  });

  it("creates the next voice and optionally assigns a selection in one transaction", () => {
    const before = {
      ...document(),
      voiceOrder: ["voice-1", "voice-3"],
      rangeAssignedNoteIds: new Set(["a"]),
    };

    const after = applyEditorCommand(before, {
      kind: "createVoice",
      assignSelection: ["a", "b"],
    });

    expectSingleRevisionStep(before, after);
    expect(after.voiceOrder).toEqual(["voice-1", "voice-3", "voice-4"]);
    expect(after.voiceOverrides).toEqual({ a: "voice-4", b: "voice-4" });
    expect(after.rangeAssignedNoteIds).toEqual(new Set());
  });

  it("creates an empty voice when no selection is supplied", () => {
    const before = document();

    const after = applyEditorCommand(before, { kind: "createVoice" });

    expectSingleRevisionStep(before, after);
    expect(after.voiceOrder).toEqual(["voice-1", "voice-2", "voice-3"]);
    expect(after.voiceOverrides).toEqual({});
  });

  it("renames a voice through a normal transaction", () => {
    const before = document();

    const after = applyEditorCommand(before, {
      kind: "renameVoice",
      voiceId: "voice-2",
      label: "Bass",
    });

    expectSingleRevisionStep(before, after);
    expect(after.voiceLabels).toEqual({ "voice-1": "Lead", "voice-2": "Bass" });
  });

  it("merges every materialized source assignment, removes range ownership, and drops the source voice", () => {
    const before = {
      ...document({ b: "voice-1" }),
      rangeAssignedNoteIds: new Set(["b"]),
    };

    const after = applyEditorCommand(before, {
      kind: "mergeVoice",
      from: "voice-1",
      to: "voice-2",
    });

    expectSingleRevisionStep(before, after);
    expect(after.voiceOverrides).toEqual({ a: "voice-2", b: "voice-2" });
    expect(after.rangeAssignedNoteIds).toEqual(new Set());
    expect(after.voiceOrder).toEqual(["voice-2"]);
  });

  it("handles an ineligible merge as a total no-op transaction", () => {
    const before = document();

    const after = applyEditorCommand(before, {
      kind: "mergeVoice",
      from: "voice-1",
      to: "voice-1",
    });

    expectSingleRevisionStep(before, after);
    expect(after.voiceOverrides).toEqual(before.voiceOverrides);
    expect(after.voiceOrder).toEqual(before.voiceOrder);
  });

  it("reorders a voice by one valid position and safely ignores an out-of-range request", () => {
    const before = document();

    const moved = applyEditorCommand(before, {
      kind: "reorderVoice",
      voiceId: "voice-1",
      direction: 1,
    });
    const ignored = applyEditorCommand(moved, {
      kind: "reorderVoice",
      voiceId: "voice-1",
      direction: 1,
    });

    expectSingleRevisionStep(before, moved);
    expect(moved.voiceOrder).toEqual(["voice-2", "voice-1"]);
    expectSingleRevisionStep(moved, ignored);
    expect(ignored.voiceOrder).toEqual(["voice-2", "voice-1"]);
  });

  it("applies range assignments without overwriting later hand corrections", () => {
    const before = {
      ...document({ a: "voice-hand-corrected", b: "voice-1" }),
      rangeAssignedNoteIds: new Set(["b", "orphan"]),
    };

    const after = applyEditorCommand(before, {
      kind: "applyRangeAssignments",
      assignments: new Map([
        ["a", "voice-2"],
        ["b", "voice-2"],
        ["c", "voice-1"],
      ]),
    });

    expectSingleRevisionStep(before, after);
    expect(after.voiceOverrides).toEqual({
      a: "voice-hand-corrected",
      b: "voice-2",
      c: "voice-1",
    });
    expect(after.rangeAssignedNoteIds).toEqual(new Set(["b", "c"]));
  });

  it("replaces only the base project, order, and actual provenance while retaining corrections", () => {
    const before = {
      ...document({ a: "voice-2" }),
      rangeAssignedNoteIds: new Set(["a"]),
    };
    const reassigned: AssignmentProvenance = {
      kind: "reassigned",
      strategy: "REGISTER_PRIORITY",
      mode: "GLOBAL",
      maxVoiceCount: 4,
      algorithmVersion: 7,
    };
    const replacement = project([note("a", "voice-9")]);

    const after = applyEditorCommand(before, {
      kind: "replaceProject",
      project: replacement,
      provenance: reassigned,
      voiceOrder: ["voice-9"],
      voiceLabels: { "voice-9": "Lead" },
    });

    expectSingleRevisionStep(before, after);
    expect(after.project).toBe(replacement);
    expect(after.voiceOrder).toEqual(["voice-9"]);
    expect(after.assignmentProvenance).toEqual(reassigned);
    expect(after.voiceOverrides).toEqual({ a: "voice-2" });
    expect(after.rangeAssignedNoteIds).toEqual(new Set(["a"]));
    // Labels are reconciled onto the reallocated voice id, not left orphaned.
    expect(after.voiceLabels).toEqual({ "voice-9": "Lead" });
  });

  it("restores all document fields atomically while retaining the active document identity", () => {
    const before = document({ a: "voice-2" });
    const restored: EditorDocument = {
      documentId: "snapshot-document-id-must-not-take-over",
      revision: 99,
      project: null,
      voiceOverrides: { b: "voice-3" },
      voiceOrder: ["voice-3"],
      voiceLabels: { "voice-3": "Restored" },
      rangeAssignedNoteIds: new Set(["b", "orphan"]),
      assignmentProvenance: { kind: "appExportedVoiceTracks" },
    };

    const after = applyEditorCommand(before, { kind: "restoreDocument", document: restored });

    expectSingleRevisionStep(before, after);
    expect(after.project).toBeNull();
    expect(after.voiceOverrides).toEqual({ b: "voice-3" });
    expect(after.voiceOrder).toEqual(["voice-3"]);
    expect(after.voiceLabels).toEqual({ "voice-3": "Restored" });
    expect(after.rangeAssignedNoteIds).toEqual(new Set(["b"]));
    expect(after.assignmentProvenance).toEqual({ kind: "appExportedVoiceTracks" });
  });

  it("normalizes an invalid incoming range set for every command and never mutates its inputs", () => {
    const before = {
      ...document({ a: "voice-1" }),
      rangeAssignedNoteIds: new Set(["a", "orphan"]),
    };
    const command: EditorCommand = { kind: "renameVoice", voiceId: "voice-1", label: "Lead" };

    const after = applyEditorCommand(before, command);

    expectSingleRevisionStep(before, after);
    expect(after.rangeAssignedNoteIds).toEqual(new Set(["a"]));
    expect(before.rangeAssignedNoteIds).toEqual(new Set(["a", "orphan"]));
    expect(after.voiceOverrides).not.toBe(before.voiceOverrides);
    expect(after.rangeAssignedNoteIds).not.toBe(before.rangeAssignedNoteIds);
  });
});
