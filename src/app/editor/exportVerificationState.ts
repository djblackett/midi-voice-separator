import type { ExportMidiResult, RoundTripVerificationReport } from "../../lib/tauri/commands";
import type { BranchId } from "./editorBranch";
import type { DocumentId } from "./editorDocument";

/** Immutable editor identity captured when an export is initiated. */
export interface ExportVerificationTarget {
  readonly branchId: BranchId;
  readonly documentId: DocumentId;
  readonly revision: number;
}

/**
 * A completed export belongs only to the materialized editor revision that
 * produced it. It is presentation state, never a snapshot or a new document.
 */
export interface ExportVerificationState extends ExportVerificationTarget {
  readonly exportPath: string;
  readonly trackCount: number;
  readonly noteCount: number;
  readonly report: RoundTripVerificationReport;
}

export function createExportVerificationState(
  target: ExportVerificationTarget,
  result: ExportMidiResult,
): ExportVerificationState {
  return {
    ...target,
    exportPath: result.path,
    trackCount: result.trackCount,
    noteCount: result.noteCount,
    report: result.verification,
  };
}

/** A result may render only while its original editor target remains current. */
export function isExportVerificationCurrent(
  result: ExportVerificationTarget,
  current: ExportVerificationTarget,
): boolean {
  return (
    result.branchId === current.branchId &&
    result.documentId === current.documentId &&
    result.revision === current.revision
  );
}

/** Drops a result once any editor identity component changes. */
export function retainExportVerificationForTarget(
  result: ExportVerificationState | null,
  current: ExportVerificationTarget,
): ExportVerificationState | null {
  return result && isExportVerificationCurrent(result, current) ? result : null;
}
