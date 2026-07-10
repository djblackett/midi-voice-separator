import { useCallback, useState } from "react";
import { commit, createEditorBranch, redo, undo, type EditorBranch } from "./editorBranch";
import type { EditorCommand } from "./editorCommand";
import type { EditorDocument } from "./editorDocument";

function emptyDocument(): EditorDocument {
  return {
    documentId: "A",
    revision: 0,
    project: null,
    voiceOverrides: {},
    voiceOrder: [],
    voiceLabels: {},
    rangeAssignedNoteIds: new Set(),
    assignmentProvenance: { kind: "imported", algorithmVersion: 1 },
  };
}

/**
 * Owns one complete editor branch. App code receives a command-only mutation
 * API plus explicit import reset and branch-local history navigation.
 */
export function useEditorBranch(): {
  branch: EditorBranch;
  document: EditorDocument;
  dispatch: (command: EditorCommand) => void;
  undo: () => boolean;
  redo: () => boolean;
  reset: (document: EditorDocument) => void;
} {
  const [branch, setBranch] = useState<EditorBranch>(() =>
    createEditorBranch("A", emptyDocument()),
  );

  const dispatch = useCallback((command: EditorCommand) => {
    setBranch((current) => commit(current, command));
  }, []);

  const undoBranch = useCallback(() => {
    const next = undo(branch);
    if (next === branch) {
      return false;
    }

    setBranch(next);
    return true;
  }, [branch]);

  const redoBranch = useCallback(() => {
    const next = redo(branch);
    if (next === branch) {
      return false;
    }

    setBranch(next);
    return true;
  }, [branch]);

  const reset = useCallback((document: EditorDocument) => {
    setBranch((current) => createEditorBranch(current.branchId, document, current.forkedFrom));
  }, []);

  return { branch, document: branch.present, dispatch, undo: undoBranch, redo: redoBranch, reset };
}
