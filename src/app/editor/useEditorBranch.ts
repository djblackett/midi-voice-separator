import { useCallback, useRef, useState } from "react";
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
  currentRevision: () => { branchId: EditorBranch["branchId"]; revision: number };
} {
  const [branch, setBranch] = useState<EditorBranch>(() =>
    createEditorBranch("A", emptyDocument()),
  );
  const branchRef = useRef(branch);
  branchRef.current = branch;

  const dispatch = useCallback((command: EditorCommand) => {
    setBranch((current) => {
      const next = commit(current, command);
      branchRef.current = next;
      return next;
    });
  }, []);

  const undoBranch = useCallback(() => {
    const next = undo(branch);
    if (next === branch) {
      return false;
    }

    branchRef.current = next;
    setBranch(next);
    return true;
  }, [branch]);

  const redoBranch = useCallback(() => {
    const next = redo(branch);
    if (next === branch) {
      return false;
    }

    branchRef.current = next;
    setBranch(next);
    return true;
  }, [branch]);

  const reset = useCallback((document: EditorDocument) => {
    setBranch((current) => {
      const next = createEditorBranch(current.branchId, document, current.forkedFrom);
      branchRef.current = next;
      return next;
    });
  }, []);

  const currentRevision = useCallback(
    () => ({ branchId: branchRef.current.branchId, revision: branchRef.current.present.revision }),
    [],
  );

  return {
    branch,
    document: branch.present,
    dispatch,
    undo: undoBranch,
    redo: redoBranch,
    reset,
    currentRevision,
  };
}
