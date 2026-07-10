import { useCallback } from "react";
import type { EditorHistoryState, EditorSnapshot } from "../editorHistory";
import { commit, type EditorBranch } from "./editorBranch";
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

/**
 * Transitional branch owner for the existing App state. It adapts the legacy
 * snapshot history while exposing only command dispatch to callers. A6
 * removes this adapter once every editor mutation has moved to the branch.
 */
export function useEditorBranch({ document, history, onCommit }: UseEditorBranchOptions): {
  dispatch: (command: EditorCommand) => void;
} {
  const dispatch = useCallback(
    (command: EditorCommand) => {
      const branch: EditorBranch = {
        branchId: "A",
        present: document,
        history: {
          past: history.past.map((snapshot) => documentFromLegacySnapshot(snapshot, document)),
          future: history.future.map((snapshot) => documentFromLegacySnapshot(snapshot, document)),
        },
        forkedFrom: null,
      };
      const next = commit(branch, command);

      onCommit({
        document: next.present,
        history: {
          past: next.history.past.map(legacySnapshotFromDocument),
          future: next.history.future.map(legacySnapshotFromDocument),
        },
      });
    },
    [document, history, onCommit],
  );

  return { dispatch };
}
