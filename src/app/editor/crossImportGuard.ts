import type { BranchId } from "./editorBranch";
import type { DocumentId } from "./editorDocument";
import type { ReferenceDocumentId } from "../referenceDocument";

/** Immutable identity for one external-reference matching request. */
export interface CrossImportRequestRef {
  readonly requestId: number;
  readonly branchId: BranchId;
  readonly documentId: DocumentId;
  readonly revision: number;
  readonly referenceDocumentId: ReferenceDocumentId;
}

export type CurrentCrossImportTarget = CrossImportRequestRef;

/**
 * An async response may install only for the exact branch/document/revision
 * and request sequence that created it. A replacement reference is part of
 * that identity too, so an older file chooser result cannot overwrite it.
 */
export function canApplyCrossImportResult(
  request: CrossImportRequestRef,
  current: CurrentCrossImportTarget,
): boolean {
  return (
    request.requestId === current.requestId &&
    request.branchId === current.branchId &&
    request.documentId === current.documentId &&
    request.revision === current.revision &&
    request.referenceDocumentId === current.referenceDocumentId
  );
}
