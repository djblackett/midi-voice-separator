import type { CrossImportDiff } from "../../domain/midi/crossImportDiff";
import type {
  CorrespondenceNoteRef,
  CrossImportMatchCoverage,
} from "../../domain/midi/noteCorrespondence";

export function formatMatcherCoverage(coverage: CrossImportMatchCoverage): string {
  return [
    coverage.total + " total",
    coverage.exact + " exact",
    coverage.fuzzy + " fuzzy",
    coverage.ambiguous + " ambiguous",
    coverage.unmatched + " unmatched",
  ].join(" · ");
}

export function formatTrustedPairCoverage(coverage: number): string {
  const percentage = coverage * 100;
  const fractionDigits = Number.isInteger(percentage) ? 0 : 1;
  return percentage.toFixed(fractionDigits) + "%";
}

export function describeCrossImportIncomparable(
  diff: Extract<CrossImportDiff, { comparable: false }>,
): string {
  return diff.reason === "INSUFFICIENT_MATCHER_COVERAGE"
    ? "The matcher found too little related note coverage to compare assignments."
    : "Too few notes have unambiguous pairs to compare assignments safely.";
}

/** Shows the parser-local note id only together with its source document. */
export function formatCorrespondenceNoteRef(reference: CorrespondenceNoteRef): string {
  return reference.noteId + " (" + reference.documentId + ")";
}
