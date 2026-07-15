import { describe, expect, it } from "vitest";
import type { CrossImportDiff } from "../../domain/midi/crossImportDiff";
import {
  describeCrossImportIncomparable,
  formatCorrespondenceNoteRef,
  formatMatcherCoverage,
  formatTrustedPairCoverage,
} from "./crossImportSummary";

describe("cross-import summary formatting", () => {
  it("keeps matcher coverage categories visible instead of treating them as trusted pairs", () => {
    expect(
      formatMatcherCoverage({ total: 8, exact: 3, fuzzy: 1, ambiguous: 2, unmatched: 2 }),
    ).toBe("8 total · 3 exact · 1 fuzzy · 2 ambiguous · 2 unmatched");
    expect(formatTrustedPairCoverage(0.625)).toBe("62.5%");
  });

  it("explains each incomparable gate without producing an assignment claim", () => {
    const matcherCoverage: CrossImportDiff = {
      comparable: false,
      reason: "INSUFFICIENT_MATCHER_COVERAGE",
      matcher: {
        matcherVersion: 1,
        policy: "CROSS_IMPORT_V1",
        referenceCoverage: { total: 2, exact: 0, fuzzy: 0, ambiguous: 0, unmatched: 2 },
        editableCoverage: { total: 2, exact: 0, fuzzy: 0, ambiguous: 0, unmatched: 2 },
        exactPairCount: 0,
        fuzzyPairCount: 0,
      },
      trustedPairCoverage: { reference: 0, editable: 0 },
    };
    const pairCoverage: CrossImportDiff = {
      ...matcherCoverage,
      reason: "INSUFFICIENT_UNAMBIGUOUS_PAIRS",
    };

    expect(describeCrossImportIncomparable(matcherCoverage)).toContain("too little related note");
    expect(describeCrossImportIncomparable(pairCoverage)).toContain("unambiguous pairs");
  });

  it("never formats a cross-import note id without its document", () => {
    expect(formatCorrespondenceNoteRef({ documentId: "reference-2", noteId: "note-7" })).toBe(
      "note-7 (reference-2)",
    );
  });
});
