import { describe, expect, it } from "vitest";
import { commit, createEditorBranch, redo, undo } from "./editorBranch";
import type { EditorDocument } from "./editorDocument";

function document(): EditorDocument {
  return {
    documentId: "document-a",
    revision: 0,
    project: null,
    voiceOverrides: {},
    voiceOrder: ["voice-1", "voice-2"],
    voiceLabels: {},
    rangeAssignedNoteIds: new Set(),
    assignmentProvenance: { kind: "imported", algorithmVersion: 1 },
  };
}

describe("EditorBranch", () => {
  it("starts with an empty document-specific history", () => {
    const branch = createEditorBranch("A", document());

    expect(branch).toMatchObject({
      branchId: "A",
      forkedFrom: null,
      history: { past: [], future: [] },
    });
    expect(branch.present).toEqual(document());
  });

  it("records the pre-command document and clears redo on commit", () => {
    const initial = createEditorBranch("A", document());
    const afterFirst = commit(initial, {
      kind: "assignNotes",
      noteIds: ["note-a"],
      voiceId: "voice-1",
    });
    const afterUndo = undo(afterFirst);
    const afterSecond = commit(afterUndo, {
      kind: "renameVoice",
      voiceId: "voice-1",
      label: "Lead",
    });

    expect(afterFirst.present.voiceOverrides).toEqual({ "note-a": "voice-1" });
    expect(afterFirst.history.past).toEqual([initial.present]);
    expect(afterSecond.history.past).toEqual([initial.present]);
    expect(afterSecond.history.future).toEqual([]);
    expect(afterSecond.present.voiceLabels).toEqual({ "voice-1": "Lead" });
  });

  it("undoes and redoes full EditorDocuments without changing branch identity", () => {
    const initial = createEditorBranch("B", document(), "snapshot-1");
    const assigned = commit(initial, {
      kind: "assignNotes",
      noteIds: ["note-a"],
      voiceId: "voice-2",
    });
    const renamed = commit(assigned, { kind: "renameVoice", voiceId: "voice-2", label: "Bass" });

    const undone = undo(renamed);
    const redone = redo(undone);

    expect(undone.branchId).toBe("B");
    expect(undone.forkedFrom).toBe("snapshot-1");
    expect(undone.present).toEqual(assigned.present);
    expect(undone.history.future).toEqual([renamed.present]);
    expect(redone.present).toEqual(renamed.present);
    expect(redone.history.future).toEqual([]);
  });

  it("returns the original branch reference when undo or redo has no available step", () => {
    const initial = createEditorBranch("A", document());

    expect(undo(initial)).toBe(initial);
    expect(redo(initial)).toBe(initial);
  });
});
