import type {
  AmbiguousCorrespondenceGroup,
  CorrespondenceNotePair,
  CorrespondenceNoteRef,
  CrossImportMatchCoverage,
  CrossImportMatchForConsumers,
} from "./noteCorrespondence";
import { toTrustedPairEvidence } from "./noteCorrespondence";
import { correspondVoicesFromPairs, type PairCorrespondenceSide } from "./voiceCorrespondence";

/**
 * Voice IDs are parser-local too. Unlike the editable A/B `VoiceRef`, this
 * cross-import form is qualified by the document that produced the voice.
 */
export interface CrossImportVoiceRef {
  readonly documentId: string;
  readonly voiceId: string;
}

export interface CrossImportChangedPair {
  readonly reference: CorrespondenceNoteRef;
  readonly editable: CorrespondenceNoteRef;
  readonly referenceVoice: CrossImportVoiceRef;
  readonly editableVoice: CrossImportVoiceRef;
}

export interface CrossImportVoicePair {
  readonly reference: CrossImportVoiceRef;
  readonly editable: CrossImportVoiceRef;
  readonly overlap: number;
}

export interface TrustedPairCoverage {
  readonly reference: number;
  readonly editable: number;
}

/** The native matcher facts a presentation can report without re-matching. */
export interface CrossImportMatchSummary {
  readonly matcherVersion: number;
  readonly policy: "CROSS_IMPORT_V1";
  readonly referenceCoverage: CrossImportMatchCoverage;
  readonly editableCoverage: CrossImportMatchCoverage;
  readonly exactPairCount: number;
  readonly fuzzyPairCount: number;
}

export interface CrossImportAssignmentDiff {
  readonly comparable: true;
  readonly referenceDocumentId: string;
  readonly editableDocumentId: string;
  readonly matcher: CrossImportMatchSummary;
  readonly trustedPairCoverage: TrustedPairCoverage;
  readonly changedPairs: readonly CrossImportChangedPair[];
  readonly matchedVoices: readonly CrossImportVoicePair[];
  readonly addedEditableVoices: readonly CrossImportVoiceRef[];
  readonly removedReferenceVoices: readonly CrossImportVoiceRef[];
  readonly ambiguous: readonly AmbiguousCorrespondenceGroup[];
  readonly unmatchedReference: readonly CorrespondenceNoteRef[];
  readonly unmatchedEditable: readonly CorrespondenceNoteRef[];
}

export interface CrossImportDiffIncomparable {
  readonly comparable: false;
  readonly reason: "INSUFFICIENT_MATCHER_COVERAGE" | "INSUFFICIENT_UNAMBIGUOUS_PAIRS";
  readonly matcher: CrossImportMatchSummary;
  readonly trustedPairCoverage: TrustedPairCoverage;
}

export type CrossImportDiff = CrossImportAssignmentDiff | CrossImportDiffIncomparable;

const MIN_TRUSTED_PAIR_COVERAGE = 0.5;

/**
 * Computes assignment evidence across independently imported documents. This
 * intentionally does not call `diffAssignments`: its local note-id semantics
 * remain exclusively for same-lineage snapshots and editable A/B branches.
 */
export function diffCrossImportAssignments(
  reference: PairCorrespondenceSide,
  editable: PairCorrespondenceSide,
  matcherResult: CrossImportMatchForConsumers,
): CrossImportDiff {
  const evidence = toTrustedPairEvidence(matcherResult);
  const matcher = toMatchSummary(matcherResult);
  const trustedPairs =
    evidence.kind === "trustedPairs"
      ? sortPairs(
          evidence.pairs.filter(
            (pair) =>
              pair.reference.documentId === reference.documentId &&
              pair.editable.documentId === editable.documentId,
          ),
        )
      : [];
  const trustedPairCoverage = {
    reference: coverageFor(trustedPairs.length, matcher.referenceCoverage.total),
    editable: coverageFor(trustedPairs.length, matcher.editableCoverage.total),
  };

  if (evidence.kind === "incomparable") {
    return {
      comparable: false,
      reason: "INSUFFICIENT_MATCHER_COVERAGE",
      matcher,
      trustedPairCoverage,
    };
  }

  if (
    trustedPairCoverage.reference < MIN_TRUSTED_PAIR_COVERAGE ||
    trustedPairCoverage.editable < MIN_TRUSTED_PAIR_COVERAGE
  ) {
    return {
      comparable: false,
      reason: "INSUFFICIENT_UNAMBIGUOUS_PAIRS",
      matcher,
      trustedPairCoverage,
    };
  }

  const correspondence = correspondVoicesFromPairs(reference, editable, trustedPairs);
  const editableVoiceByReference = new Map(
    correspondence.matched.map((pair) => [pair.aVoiceId, pair.bVoiceId]),
  );
  const changedPairs = trustedPairs
    .flatMap((pair) => {
      const referenceVoiceId = reference.assignments.get(pair.reference.noteId);
      const editableVoiceId = editable.assignments.get(pair.editable.noteId);
      if (
        referenceVoiceId === undefined ||
        editableVoiceId === undefined ||
        editableVoiceByReference.get(referenceVoiceId) === editableVoiceId
      ) {
        return [];
      }
      return [
        {
          reference: pair.reference,
          editable: pair.editable,
          referenceVoice: { documentId: reference.documentId, voiceId: referenceVoiceId },
          editableVoice: { documentId: editable.documentId, voiceId: editableVoiceId },
        },
      ];
    })
    .sort(compareChangedPairs);

  return {
    comparable: true,
    referenceDocumentId: reference.documentId,
    editableDocumentId: editable.documentId,
    matcher,
    trustedPairCoverage,
    changedPairs,
    matchedVoices: correspondence.matched
      .map((pair) => ({
        reference: { documentId: reference.documentId, voiceId: pair.aVoiceId },
        editable: { documentId: editable.documentId, voiceId: pair.bVoiceId },
        overlap: pair.overlap,
      }))
      .sort(compareVoicePairs),
    addedEditableVoices: correspondence.unmatchedB
      .map((voiceId) => ({ documentId: editable.documentId, voiceId }))
      .sort(compareVoiceRefs),
    removedReferenceVoices: correspondence.unmatchedA
      .map((voiceId) => ({ documentId: reference.documentId, voiceId }))
      .sort(compareVoiceRefs),
    ambiguous: sortAmbiguous(evidence.diagnostics.ambiguous),
    unmatchedReference: sortNoteRefs(evidence.diagnostics.unmatchedReference),
    unmatchedEditable: sortNoteRefs(evidence.diagnostics.unmatchedEditable),
  };
}

/**
 * Returns local note IDs only after the requested document has been validated
 * against the corresponding side. This is the safe adapter for canvas cues.
 */
export function changedNoteIdsForSide(
  diff: CrossImportDiff,
  target: { readonly documentId: string; readonly side: "reference" | "editable" },
): readonly string[] {
  if (
    !diff.comparable ||
    (target.side === "reference" && target.documentId !== diff.referenceDocumentId) ||
    (target.side === "editable" && target.documentId !== diff.editableDocumentId)
  ) {
    return [];
  }
  return diff.changedPairs.map((pair) =>
    target.side === "reference" ? pair.reference.noteId : pair.editable.noteId,
  );
}

function toMatchSummary(result: CrossImportMatchForConsumers): CrossImportMatchSummary {
  return {
    matcherVersion: result.matcherVersion,
    policy: result.policy,
    referenceCoverage: result.referenceCoverage,
    editableCoverage: result.editableCoverage,
    exactPairCount: result.exactPairs.length,
    fuzzyPairCount: result.fuzzyPairs.length,
  };
}

function coverageFor(trustedPairCount: number, total: number): number {
  return total === 0 ? 1 : trustedPairCount / total;
}

function sortPairs<T extends CorrespondenceNotePair>(pairs: readonly T[]): T[] {
  return [...pairs].sort(
    (left, right) =>
      compareNoteRefs(left.reference, right.reference) ||
      compareNoteRefs(left.editable, right.editable),
  );
}

function sortNoteRefs(refs: readonly CorrespondenceNoteRef[]): CorrespondenceNoteRef[] {
  return [...refs].sort(compareNoteRefs);
}

function compareNoteRefs(left: CorrespondenceNoteRef, right: CorrespondenceNoteRef): number {
  return left.documentId.localeCompare(right.documentId) || left.noteId.localeCompare(right.noteId);
}

function compareVoiceRefs(left: CrossImportVoiceRef, right: CrossImportVoiceRef): number {
  return (
    left.documentId.localeCompare(right.documentId) || left.voiceId.localeCompare(right.voiceId)
  );
}

function compareChangedPairs(left: CrossImportChangedPair, right: CrossImportChangedPair): number {
  return (
    compareNoteRefs(left.reference, right.reference) ||
    compareNoteRefs(left.editable, right.editable)
  );
}

function compareVoicePairs(left: CrossImportVoicePair, right: CrossImportVoicePair): number {
  return (
    compareVoiceRefs(left.reference, right.reference) ||
    compareVoiceRefs(left.editable, right.editable)
  );
}

function sortAmbiguous(
  groups: readonly AmbiguousCorrespondenceGroup[],
): AmbiguousCorrespondenceGroup[] {
  return [...groups]
    .map((group) => ({
      kind: group.kind,
      reference: sortNoteRefs(group.reference),
      editable: sortNoteRefs(group.editable),
    }))
    .sort(
      (left, right) =>
        left.kind.localeCompare(right.kind) ||
        compareNoteRefs(left.reference[0] ?? emptyNoteRef, right.reference[0] ?? emptyNoteRef) ||
        compareNoteRefs(left.editable[0] ?? emptyNoteRef, right.editable[0] ?? emptyNoteRef),
    );
}

const emptyNoteRef: CorrespondenceNoteRef = { documentId: "", noteId: "" };
