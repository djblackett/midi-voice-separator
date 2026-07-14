import { describe, expect, expectTypeOf, it } from "vitest";
import {
  toTrustedPairEvidence,
  type CorrespondenceNoteRef,
  type CrossImportMatchForConsumers,
  type TrustedPairEvidence,
} from "./noteCorrespondence";

function note(documentId: string, noteId: string): CorrespondenceNoteRef {
  return { documentId, noteId };
}

function comparableResult(
  changes: Partial<Extract<CrossImportMatchForConsumers, { comparable: true }>> = {},
): Extract<CrossImportMatchForConsumers, { comparable: true }> {
  return {
    matcherVersion: 1,
    policy: "CROSS_IMPORT_V1",
    comparable: true,
    incomparableReason: null,
    exactPairs: [],
    fuzzyPairs: [],
    ambiguous: [],
    unmatchedReference: [],
    unmatchedEditable: [],
    ...changes,
  };
}

describe("toTrustedPairEvidence", () => {
  it("exposes only unambiguous exact and fuzzy pairs as voice-overlap evidence", () => {
    const evidence = toTrustedPairEvidence(
      comparableResult({
        exactPairs: [{ reference: note("reference-1", "r-exact"), editable: note("A", "a-exact") }],
        fuzzyPairs: [{ reference: note("reference-1", "r-fuzzy"), editable: note("A", "a-fuzzy") }],
      }),
    );

    expect(evidence).toEqual({
      kind: "trustedPairs",
      matcherVersion: 1,
      policy: "CROSS_IMPORT_V1",
      pairs: [
        {
          kind: "exact",
          reference: note("reference-1", "r-exact"),
          editable: note("A", "a-exact"),
        },
        {
          kind: "fuzzy",
          reference: note("reference-1", "r-fuzzy"),
          editable: note("A", "a-fuzzy"),
        },
      ],
      diagnostics: { ambiguous: [], unmatchedReference: [], unmatchedEditable: [] },
    });
  });

  it("keeps ambiguous and unmatched notes side-qualified diagnostics", () => {
    const evidence = toTrustedPairEvidence(
      comparableResult({
        ambiguous: [
          {
            kind: "DUPLICATE_EXACT",
            reference: [note("reference-1", "r-1"), note("reference-1", "r-2")],
            editable: [note("A", "a-1"), note("A", "a-2")],
          },
        ],
        unmatchedReference: [note("reference-1", "r-only")],
        unmatchedEditable: [note("A", "a-only")],
      }),
    );

    expect(evidence.kind).toBe("trustedPairs");
    if (evidence.kind === "trustedPairs") {
      expect(evidence.diagnostics.ambiguous[0]?.reference[0]?.documentId).toBe("reference-1");
      expect(evidence.diagnostics.ambiguous[0]?.editable[0]?.documentId).toBe("A");
      expect(evidence.diagnostics.unmatchedReference[0]).toEqual(note("reference-1", "r-only"));
      expect(evidence.diagnostics.unmatchedEditable[0]).toEqual(note("A", "a-only"));
    }
  });

  it("never exposes pairs or assignment counts for an incomparable matcher result", () => {
    const result: Extract<CrossImportMatchForConsumers, { comparable: false }> = {
      matcherVersion: 1,
      policy: "CROSS_IMPORT_V1",
      comparable: false,
      incomparableReason: "INSUFFICIENT_COVERAGE",
      exactPairs: [],
      fuzzyPairs: [],
      ambiguous: [],
      unmatchedReference: [note("reference-1", "r-only")],
      unmatchedEditable: [note("A", "a-only")],
    };
    const evidence = toTrustedPairEvidence(result);

    expect(evidence).toEqual({
      kind: "incomparable",
      matcherVersion: 1,
      policy: "CROSS_IMPORT_V1",
      reason: "INSUFFICIENT_COVERAGE",
      diagnostics: {
        ambiguous: [],
        unmatchedReference: [note("reference-1", "r-only")],
        unmatchedEditable: [note("A", "a-only")],
      },
    });
    expect("pairs" in evidence).toBe(false);
    expectTypeOf(evidence).toEqualTypeOf<TrustedPairEvidence>();
  });

  it("fails closed when malformed wire data repeats a trusted local reference", () => {
    const evidence = toTrustedPairEvidence(
      comparableResult({
        exactPairs: [
          { reference: note("reference-1", "r"), editable: note("A", "a-1") },
          { reference: note("reference-1", "r"), editable: note("A", "a-2") },
        ],
      }),
    );

    expect(evidence.kind).toBe("incomparable");
    if (evidence.kind === "incomparable") {
      expect(evidence.reason).toBe("DUPLICATE_TRUSTED_REFERENCE");
    }
  });
});
