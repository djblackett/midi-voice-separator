import { describe, expect, it } from "vitest";
import { createEditorBranch } from "./editorBranch";
import type { EditorCommand } from "./editorCommand";
import type { EditorDocument } from "./editorDocument";
import {
  activeBranch,
  branchForSide,
  commitActive,
  createComparisonBranches,
  discardSideB,
  forkSideB,
  redoActive,
  resetSideA,
  setActiveSide,
  undoActive,
} from "./comparisonBranches";

function document(id: string, overrides: Record<string, string> = {}): EditorDocument {
  return {
    documentId: id,
    revision: 0,
    project: null,
    voiceOverrides: overrides,
    voiceOrder: ["voice-1", "voice-2"],
    voiceLabels: {},
    rangeAssignedNoteIds: new Set(),
    assignmentProvenance: { kind: "imported", algorithmVersion: 1 },
  };
}

const rename: EditorCommand = { kind: "renameVoice", voiceId: "voice-1", label: "Lead" };

function branches() {
  return createComparisonBranches(createEditorBranch("A", document("A")));
}

describe("comparison branches", () => {
  it("starts with side A active and no forked B", () => {
    const start = branches();
    expect(start.activeSide).toBe("A");
    expect(start.B).toBeNull();
    expect(activeBranch(start)).toBe(start.A);
  });

  it("routes commits and history to side A while it is active", () => {
    const committed = commitActive(branches(), rename);
    expect(committed.A.present.revision).toBe(1);
    expect(committed.A.present.voiceLabels).toEqual({ "voice-1": "Lead" });
    expect(committed.B).toBeNull();
  });

  it("forks B with its own history without touching A or the source document", () => {
    const source = document("B", { note: "voice-2" });
    const forked = forkSideB(branches(), source, "snapshot-7");

    expect(forked.B?.forkedFrom).toBe("snapshot-7");
    expect(forked.B?.present).toBe(source);
    expect(forked.B?.history).toEqual({ past: [], future: [] });
    expect(forked.A.present.revision).toBe(0);
    // The forked source document is never mutated by later B edits.
    const editedB = commitActive(setActiveSide(forked, "B"), rename);
    expect(source.voiceLabels).toEqual({});
    expect(editedB.B?.present.voiceLabels).toEqual({ "voice-1": "Lead" });
  });

  it("edits and undoes A and B independently", () => {
    const forked = forkSideB(branches(), document("B"), null);

    const bEdited = commitActive(setActiveSide(forked, "B"), rename);
    expect(bEdited.B?.present.revision).toBe(1);
    expect(bEdited.A.present.revision).toBe(0);

    const aEdited = commitActive(setActiveSide(bEdited, "A"), {
      kind: "renameVoice",
      voiceId: "voice-2",
      label: "Bass",
    });
    expect(aEdited.A.present.voiceLabels).toEqual({ "voice-2": "Bass" });
    expect(aEdited.B?.present.voiceLabels).toEqual({ "voice-1": "Lead" });

    // Undo on the active side (A) leaves B untouched.
    const aUndone = undoActive(aEdited);
    expect(aUndone.A.present.voiceLabels).toEqual({});
    expect(aUndone.B?.present.voiceLabels).toEqual({ "voice-1": "Lead" });
  });

  it("ignores activation of a side that has not been forked and no-op history", () => {
    const start = branches();
    expect(setActiveSide(start, "B")).toBe(start);
    // undo/redo with empty history return the same value (identity).
    expect(undoActive(start)).toBe(start);
    expect(redoActive(start)).toBe(start);
  });

  it("discards B and returns to side A", () => {
    const forked = setActiveSide(forkSideB(branches(), document("B"), null), "B");
    const discarded = discardSideB(forked);
    expect(discarded.B).toBeNull();
    expect(discarded.activeSide).toBe("A");
    expect(branchForSide(discarded, "B")).toBeNull();
  });

  it("resets side A and drops B on a fresh import", () => {
    const forked = forkSideB(branches(), document("B"), null);
    const reset = resetSideA(forked, document("A", { note: "voice-1" }));
    expect(reset.activeSide).toBe("A");
    expect(reset.B).toBeNull();
    expect(reset.A.present.voiceOverrides).toEqual({ note: "voice-1" });
    expect(reset.A.history).toEqual({ past: [], future: [] });
  });
});
