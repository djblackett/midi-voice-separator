import {
  commit,
  createEditorBranch,
  redo,
  undo,
  type BranchId,
  type EditorBranch,
} from "./editorBranch";
import type { EditorCommand } from "./editorCommand";
import type { EditorDocument } from "./editorDocument";

/**
 * The two comparison sides sharing one branch type and one command system
 * (M2). `A` is the primary working branch; `B` is forked from an immutable
 * snapshot only while a comparison is open. `activeSide` names the branch that
 * edits, undo/redo, and inspectors bind to -- never a copied project, diff, or
 * score (M4). Every mutation routes through the same `commit`/`undo`/`redo`
 * used for a lone branch, so neither side can drift onto a private edit path.
 */
export interface ComparisonBranches {
  readonly activeSide: BranchId;
  readonly A: EditorBranch;
  readonly B: EditorBranch | null;
}

export function createComparisonBranches(a: EditorBranch): ComparisonBranches {
  return { activeSide: "A", A: a, B: null };
}

export function activeBranch(branches: ComparisonBranches): EditorBranch {
  return branches.activeSide === "B" && branches.B ? branches.B : branches.A;
}

export function branchForSide(branches: ComparisonBranches, side: BranchId): EditorBranch | null {
  return side === "A" ? branches.A : branches.B;
}

/**
 * Forks side B from a document (a named snapshot's materialized state). The
 * source document is never retained or mutated -- B gets its own branch with a
 * fresh, independent history, so editing B can never touch the snapshot or A.
 */
export function forkSideB(
  branches: ComparisonBranches,
  document: EditorDocument,
  forkedFrom: string | null,
): ComparisonBranches {
  return { ...branches, B: createEditorBranch("B", document, forkedFrom) };
}

export function discardSideB(branches: ComparisonBranches): ComparisonBranches {
  return { ...branches, activeSide: "A", B: null };
}

export function setActiveSide(branches: ComparisonBranches, side: BranchId): ComparisonBranches {
  if (side === branches.activeSide || (side === "B" && !branches.B)) {
    return branches;
  }
  return { ...branches, activeSide: side };
}

function replaceActive(branches: ComparisonBranches, next: EditorBranch): ComparisonBranches {
  if (next === activeBranch(branches)) {
    return branches;
  }
  return branches.activeSide === "B" ? { ...branches, B: next } : { ...branches, A: next };
}

export function commitActive(
  branches: ComparisonBranches,
  command: EditorCommand,
): ComparisonBranches {
  return replaceActive(branches, commit(activeBranch(branches), command));
}

export function undoActive(branches: ComparisonBranches): ComparisonBranches {
  return replaceActive(branches, undo(activeBranch(branches)));
}

export function redoActive(branches: ComparisonBranches): ComparisonBranches {
  return replaceActive(branches, redo(activeBranch(branches)));
}

/** Resets side A on a fresh import and drops any open comparison branch. */
export function resetSideA(
  branches: ComparisonBranches,
  document: EditorDocument,
): ComparisonBranches {
  return { activeSide: "A", A: createEditorBranch("A", document, branches.A.forkedFrom), B: null };
}
