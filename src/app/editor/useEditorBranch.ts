import { useCallback } from "react";
import type { EditorHistoryState, EditorSnapshot } from "../editorHistory";
import { commit, redo, undo, type EditorBranch } from "./editorBranch";
import type { EditorCommand } from "./editorCommand";
import type { EditorDocument } from "./editorDocument";

export interface UseEditorBranchOptions {
  readonly document: EditorDocument;
  readonly history: EditorHistoryState;
  readonly onCommit: (result: {
    readonly document: EditorDocument;
    readonly history: EditorHistoryState;
  }) => void;
}

function documentFromLegacySnapshot(
  snapshot: EditorSnapshot,
  current: EditorDocument,
): EditorDocument {
  return {
    ...current,
    project: snapshot.project,
    voiceOverrides: snapshot.voiceOverrides,
    voiceOrder: snapshot.voiceOrder,
    voiceLabels: snapshot.voiceLabels,
    rangeAssignedNoteIds: snapshot.rangeAssignedNoteIds,
  };
}

function legacySnapshotFromDocument(document: EditorDocument): EditorSnapshot {
  return {
    project: document.project,
    voiceOverrides: document.voiceOverrides,
    voiceOrder: [...document.voiceOrder],
    voiceLabels: { ...document.voiceLabels },
    rangeAssignedNoteIds: new Set(document.rangeAssignedNoteIds),
  };
}

function branchFromLegacyState(
  document: EditorDocument,
  history: EditorHistoryState,
): EditorBranch {
  return {
    branchId: "A",
    present: document,
    history: {
      past: history.past.map((snapshot) => documentFromLegacySnapshot(snapshot, document)),
      future: history.future.map((snapshot) => documentFromLegacySnapshot(snapshot, document)),
    },
    forkedFrom: null,
  };
}

function reportBranchCommit(
  branch: EditorBranch,
  onCommit: UseEditorBranchOptions["onCommit"],
): void {
  onCommit({
    document: branch.present,
    history: {
      past: branch.history.past.map(legacySnapshotFromDocument),
      future: branch.history.future.map(legacySnapshotFromDocument),
    },
  });
}

/**
 * Transitional branch owner for the existing App state. It adapts the legacy
 * snapshot history while exposing only command dispatch to callers. A6
 * removes this adapter once every editor mutation has moved to the branch.
 */
export function useEditorBranch({ document, history, onCommit }: UseEditorBranchOptions): {
  dispatch: (command: EditorCommand) => void;
  undo: () => boolean;
  redo: () => boolean;
} {
  const dispatch = useCallback(
    (command: EditorCommand) => {
      reportBranchCommit(commit(branchFromLegacyState(document, history), command), onCommit);
    },
    [document, history, onCommit],
  );

  const undoBranch = useCallback(() => {
    const branch = branchFromLegacyState(document, history);
    const next = undo(branch);
    if (next === branch) {
      return false;
    }

    reportBranchCommit(next, onCommit);
    return true;
  }, [document, history, onCommit]);

  const redoBranch = useCallback(() => {
    const branch = branchFromLegacyState(document, history);
    const next = redo(branch);
    if (next === branch) {
      return false;
    }

    reportBranchCommit(next, onCommit);
    return true;
  }, [document, history, onCommit]);

  return { dispatch, undo: undoBranch, redo: redoBranch };
}
