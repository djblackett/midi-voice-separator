/**
 * A note address is valid only inside the document that supplied it. This is
 * the domain-level wire shape used by cross-import consumers; it deliberately
 * carries no claim that parser-local note IDs identify content across imports.
 */
export interface CorrespondenceNoteRef {
  readonly documentId: string;
  readonly noteId: string;
}

export interface CorrespondenceNotePair {
  readonly reference: CorrespondenceNoteRef;
  readonly editable: CorrespondenceNoteRef;
}

export interface AmbiguousCorrespondenceGroup {
  readonly kind: "DUPLICATE_EXACT" | "FUZZY_CONFLICT";
  readonly reference: readonly CorrespondenceNoteRef[];
  readonly editable: readonly CorrespondenceNoteRef[];
}

export interface CrossImportDiagnostics {
  readonly ambiguous: readonly AmbiguousCorrespondenceGroup[];
  readonly unmatchedReference: readonly CorrespondenceNoteRef[];
  readonly unmatchedEditable: readonly CorrespondenceNoteRef[];
}

/**
 * Per-side semantic coverage reported by the native matcher. Ambiguous exact
 * duplicate multiplicity can contribute here without creating an individual
 * trusted occurrence pair, so consumers must not substitute this for pair
 * coverage when deriving assignment evidence.
 */
export interface CrossImportMatchCoverage {
  readonly total: number;
  readonly exact: number;
  readonly fuzzy: number;
  readonly ambiguous: number;
  readonly unmatched: number;
}

interface CrossImportMatchBase extends CrossImportDiagnostics {
  readonly matcherVersion: number;
  readonly policy: "CROSS_IMPORT_V1";
  readonly referenceCoverage: CrossImportMatchCoverage;
  readonly editableCoverage: CrossImportMatchCoverage;
  readonly exactPairs: readonly CorrespondenceNotePair[];
  readonly fuzzyPairs: readonly CorrespondenceNotePair[];
}

export type CrossImportMatchForConsumers =
  | (CrossImportMatchBase & {
      readonly comparable: true;
      readonly incomparableReason: null;
    })
  | (CrossImportMatchBase & {
      readonly comparable: false;
      readonly incomparableReason: "INSUFFICIENT_COVERAGE";
    });

export interface TrustedCorrespondencePair extends CorrespondenceNotePair {
  readonly kind: "exact" | "fuzzy";
}

/**
 * The only evidence a later voice-overlap adapter may consume. Ambiguous and
 * unmatched refs remain diagnostics; they never become inferred pairs.
 */
export type TrustedPairEvidence =
  | {
      readonly kind: "trustedPairs";
      readonly matcherVersion: number;
      readonly policy: "CROSS_IMPORT_V1";
      readonly referenceCoverage: CrossImportMatchCoverage;
      readonly editableCoverage: CrossImportMatchCoverage;
      readonly pairs: readonly TrustedCorrespondencePair[];
      readonly diagnostics: CrossImportDiagnostics;
    }
  | {
      readonly kind: "incomparable";
      readonly matcherVersion: number;
      readonly policy: "CROSS_IMPORT_V1";
      readonly referenceCoverage: CrossImportMatchCoverage;
      readonly editableCoverage: CrossImportMatchCoverage;
      readonly reason: "INSUFFICIENT_COVERAGE" | "DUPLICATE_TRUSTED_REFERENCE";
      readonly diagnostics: CrossImportDiagnostics;
    };

/**
 * Converts Feature 7's result into the intentionally narrow downstream
 * contract. This is a defensive boundary: malformed wire data with a trusted
 * endpoint appearing twice also becomes incomparable instead of contributing
 * duplicate voice-overlap evidence.
 */
export function toTrustedPairEvidence(result: CrossImportMatchForConsumers): TrustedPairEvidence {
  const diagnostics: CrossImportDiagnostics = {
    ambiguous: result.ambiguous,
    unmatchedReference: result.unmatchedReference,
    unmatchedEditable: result.unmatchedEditable,
  };
  if (!result.comparable) {
    return {
      kind: "incomparable",
      matcherVersion: result.matcherVersion,
      policy: result.policy,
      referenceCoverage: result.referenceCoverage,
      editableCoverage: result.editableCoverage,
      reason: result.incomparableReason,
      diagnostics,
    };
  }

  const pairs: TrustedCorrespondencePair[] = [
    ...result.exactPairs.map((pair) => ({ ...pair, kind: "exact" as const })),
    ...result.fuzzyPairs.map((pair) => ({ ...pair, kind: "fuzzy" as const })),
  ];
  const referenceRefs = new Set<string>();
  const editableRefs = new Set<string>();
  for (const pair of pairs) {
    const referenceKey = `${pair.reference.documentId}\u0000${pair.reference.noteId}`;
    const editableKey = `${pair.editable.documentId}\u0000${pair.editable.noteId}`;
    if (
      referenceRefs.has(referenceKey) ||
      editableRefs.has(editableKey) ||
      pair.reference.documentId === pair.editable.documentId
    ) {
      return {
        kind: "incomparable",
        matcherVersion: result.matcherVersion,
        policy: result.policy,
        referenceCoverage: result.referenceCoverage,
        editableCoverage: result.editableCoverage,
        reason: "DUPLICATE_TRUSTED_REFERENCE",
        diagnostics,
      };
    }
    referenceRefs.add(referenceKey);
    editableRefs.add(editableKey);
  }

  return {
    kind: "trustedPairs",
    matcherVersion: result.matcherVersion,
    policy: result.policy,
    referenceCoverage: result.referenceCoverage,
    editableCoverage: result.editableCoverage,
    pairs,
    diagnostics,
  };
}
