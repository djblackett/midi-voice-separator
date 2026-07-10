import {
  createEditorHistory,
  pushHistory,
  redoHistory,
  undoHistory,
  type EditorHistoryState,
} from "../editorHistory";
import { applyEditorCommand, type EditorCommand } from "./editorCommand";
import type { EditorDocument } from "./editorDocument";

export type BranchId = "A" | "B";

export interface EditorBranch {
  readonly branchId: BranchId;
  readonly present: EditorDocument;
  readonly history: EditorHistoryState<EditorDocument>;
  readonly forkedFrom: string | null;
}

export function createEditorBranch(
  branchId: BranchId,
  present: EditorDocument,
  forkedFrom: string | null = null,
): EditorBranch {
  return { branchId, present, history: createEditorHistory<EditorDocument>(), forkedFrom };
}

/** Applies one editor command and records the preceding document for undo. */
export function commit(branch: EditorBranch, command: EditorCommand): EditorBranch {
  return {
    ...branch,
    present: applyEditorCommand(branch.present, command),
    history: pushHistory(branch.history, branch.present),
  };
}

export function undo(branch: EditorBranch): EditorBranch {
  const result = undoHistory(branch.history, branch.present);
  return result ? { ...branch, present: result.snapshot, history: result.history } : branch;
}

export function redo(branch: EditorBranch): EditorBranch {
  const result = redoHistory(branch.history, branch.present);
  return result ? { ...branch, present: result.snapshot, history: result.history } : branch;
}
