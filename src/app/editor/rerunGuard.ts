import type { BranchId } from "./editorBranch";

export interface RerunRequestRef {
  readonly branchId: BranchId;
  readonly revision: number;
  readonly requestId: number;
}

export interface CurrentBranchRevision {
  readonly branchId: BranchId;
  readonly revision: number;
  readonly requestId: number;
}

/** True only when an async rerun still targets the exact document it started from. */
export function canApplyRerunResult(
  request: RerunRequestRef,
  current: CurrentBranchRevision,
): boolean {
  return (
    request.branchId === current.branchId &&
    request.revision === current.revision &&
    request.requestId === current.requestId
  );
}
