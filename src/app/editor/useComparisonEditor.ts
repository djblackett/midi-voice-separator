import { useCallback, useRef, useState } from "react";
import {
  activeBranch as selectActiveBranch,
  commitActive,
  createComparisonBranches,
  discardSideB,
  forkSideB,
  redoActive,
  resetSideA,
  setActiveSide as selectSetActiveSide,
  undoActive,
  type ComparisonBranches,
} from "./comparisonBranches";
import { createEditorBranch, type BranchId, type EditorBranch } from "./editorBranch";
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
 * Owns both comparison branches. App code receives a command-only mutation API
 * that always targets the active side, plus explicit fork/discard/active-side
 * controls for the comparison workspace. Until a comparison is opened, side B
 * is absent and side A behaves exactly like a lone editor branch.
 */
export function useComparisonEditor(): {
  activeSide: BranchId;
  branch: EditorBranch;
  document: EditorDocument;
  branchA: EditorBranch;
  branchB: EditorBranch | null;
  dispatch: (command: EditorCommand) => void;
  undo: () => boolean;
  redo: () => boolean;
  reset: (document: EditorDocument) => void;
  forkB: (document: EditorDocument, forkedFrom: string | null) => void;
  discardB: () => void;
  setActiveSide: (side: BranchId) => void;
  currentRevision: () => { branchId: BranchId; documentId: string; revision: number };
} {
  const [branches, setBranches] = useState<ComparisonBranches>(() =>
    createComparisonBranches(createEditorBranch("A", emptyDocument())),
  );
  const branchesRef = useRef(branches);
  branchesRef.current = branches;

  const applyTransition = useCallback(
    (transition: (current: ComparisonBranches) => ComparisonBranches): boolean => {
      const next = transition(branchesRef.current);
      if (next === branchesRef.current) {
        return false;
      }
      branchesRef.current = next;
      setBranches(next);
      return true;
    },
    [],
  );

  const dispatch = useCallback(
    (command: EditorCommand) => {
      applyTransition((current) => commitActive(current, command));
    },
    [applyTransition],
  );

  const undo = useCallback(() => applyTransition(undoActive), [applyTransition]);
  const redo = useCallback(() => applyTransition(redoActive), [applyTransition]);

  const reset = useCallback(
    (document: EditorDocument) => {
      applyTransition((current) => resetSideA(current, document));
    },
    [applyTransition],
  );

  const forkB = useCallback(
    (document: EditorDocument, forkedFrom: string | null) => {
      applyTransition((current) => forkSideB(current, document, forkedFrom));
    },
    [applyTransition],
  );

  const discardB = useCallback(() => applyTransition(discardSideB), [applyTransition]);

  const setActiveSide = useCallback(
    (side: BranchId) => {
      applyTransition((current) => selectSetActiveSide(current, side));
    },
    [applyTransition],
  );

  const currentRevision = useCallback(() => {
    const active = selectActiveBranch(branchesRef.current);
    return {
      branchId: active.branchId,
      documentId: active.present.documentId,
      revision: active.present.revision,
    };
  }, []);

  const active = selectActiveBranch(branches);

  return {
    activeSide: branches.activeSide,
    branch: active,
    document: active.present,
    branchA: branches.A,
    branchB: branches.B,
    dispatch,
    undo,
    redo,
    reset,
    forkB,
    discardB,
    setActiveSide,
    currentRevision,
  };
}
