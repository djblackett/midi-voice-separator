import { describe, expect, it } from "vitest";
import {
  changedNoteIdsForSide,
  diffCrossImportAssignments,
  type CrossImportDiff,
} from "./crossImportDiff";
import type { CrossImportMatchForConsumers } from "./noteCorrespondence";
import type { PairCorrespondenceSide } from "./voiceCorrespondence";

const referenceDocumentId = "reference-1";
const editableDocumentId = "editable-1";

function side(
  documentId: string,
  assignments: Record<string, string>,
  voiceIds = [...new Set(Object.values(assignments))],
): PairCorrespondenceSide {
  return { documentId, voiceIds, assignments: new Map(Object.entries(assignments)) };
}

function matchingResult(
  changes: Partial<Extract<CrossImportMatchForConsumers, { comparable: true }>> = {},
): Extract<CrossImportMatchForConsumers, { comparable: true }> {
  return {
    matcherVersion: 1,
    policy: "CROSS_IMPORT_V1",
    comparable: true,
    incomparableReason: null,
    referenceCoverage: { total: 3, exact: 3, fuzzy: 0, ambiguous: 0, unmatched: 0 },
    editableCoverage: { total: 3, exact: 3, fuzzy: 0, ambiguous: 0, unmatched: 0 },
    exactPairs: [],
    fuzzyPairs: [],
    ambiguous: [],
    unmatchedReference: [],
    unmatchedEditable: [],
    ...changes,
  };
}

function pair(referenceNoteId: string, editableNoteId: string) {
  return {
    reference: { documentId: referenceDocumentId, noteId: referenceNoteId },
    editable: { documentId: editableDocumentId, noteId: editableNoteId },
  };
}

describe("diffCrossImportAssignments", () => {
  it("reports no reassignment when regenerated local IDs keep the derived voice mapping", () => {
    const reference = side(referenceDocumentId, { "r-1": "lead", "r-2": "lead", "r-3": "bass" });
    const editable = side(editableDocumentId, {
      "e-a": "voice-7",
      "e-b": "voice-7",
      "e-c": "voice-8",
    });
    const diff = diffCrossImportAssignments(
      reference,
      editable,
      matchingResult({ exactPairs: [pair("r-1", "e-a"), pair("r-2", "e-b"), pair("r-3", "e-c")] }),
    );

    expect(diff).toMatchObject({
      comparable: true,
      trustedPairCoverage: { reference: 1, editable: 1 },
      changedPairs: [],
      matchedVoices: [
        {
          reference: { documentId: referenceDocumentId, voiceId: "bass" },
          editable: { documentId: editableDocumentId, voiceId: "voice-8" },
          overlap: 1,
        },
        {
          reference: { documentId: referenceDocumentId, voiceId: "lead" },
          editable: { documentId: editableDocumentId, voiceId: "voice-7" },
          overlap: 2,
        },
      ],
    });
  });

  it("reports a trusted pair only when its voice differs from the derived correspondence", () => {
    const reference = side(referenceDocumentId, { "r-1": "lead", "r-2": "lead", "r-3": "bass" });
    const editable = side(editableDocumentId, {
      "e-a": "voice-7",
      "e-b": "voice-8",
      "e-c": "voice-8",
    });
    const diff = diffCrossImportAssignments(
      reference,
      editable,
      matchingResult({ exactPairs: [pair("r-1", "e-a"), pair("r-2", "e-b"), pair("r-3", "e-c")] }),
    );

    expect(diff).toMatchObject({
      comparable: true,
      changedPairs: [
        {
          reference: { documentId: referenceDocumentId, noteId: "r-2" },
          editable: { documentId: editableDocumentId, noteId: "e-b" },
          referenceVoice: { documentId: referenceDocumentId, voiceId: "lead" },
          editableVoice: { documentId: editableDocumentId, voiceId: "voice-8" },
        },
      ],
    });
    expect(
      changedNoteIdsForSide(diff, { documentId: editableDocumentId, side: "editable" }),
    ).toEqual(["e-b"]);
    expect(changedNoteIdsForSide(diff, { documentId: "other", side: "editable" })).toEqual([]);
  });

  it("does not turn duplicate-exact semantic coverage into unambiguous assignment evidence", () => {
    const diff = diffCrossImportAssignments(
      side(referenceDocumentId, { "r-1": "lead", "r-2": "lead" }),
      side(editableDocumentId, { "e-1": "voice-7", "e-2": "voice-7" }),
      matchingResult({
        referenceCoverage: { total: 2, exact: 0, fuzzy: 0, ambiguous: 2, unmatched: 0 },
        editableCoverage: { total: 2, exact: 0, fuzzy: 0, ambiguous: 2, unmatched: 0 },
        ambiguous: [
          {
            kind: "DUPLICATE_EXACT",
            reference: [
              { documentId: referenceDocumentId, noteId: "r-1" },
              { documentId: referenceDocumentId, noteId: "r-2" },
            ],
            editable: [
              { documentId: editableDocumentId, noteId: "e-1" },
              { documentId: editableDocumentId, noteId: "e-2" },
            ],
          },
        ],
      }),
    );

    expect(diff).toEqual({
      comparable: false,
      reason: "INSUFFICIENT_UNAMBIGUOUS_PAIRS",
      matcher: {
        matcherVersion: 1,
        policy: "CROSS_IMPORT_V1",
        referenceCoverage: { total: 2, exact: 0, fuzzy: 0, ambiguous: 2, unmatched: 0 },
        editableCoverage: { total: 2, exact: 0, fuzzy: 0, ambiguous: 2, unmatched: 0 },
        exactPairCount: 0,
        fuzzyPairCount: 0,
      },
      trustedPairCoverage: { reference: 0, editable: 0 },
    });
  });

  it("preserves an insufficient matcher-coverage result as incomparable", () => {
    const result: Extract<CrossImportMatchForConsumers, { comparable: false }> = {
      matcherVersion: 1,
      policy: "CROSS_IMPORT_V1",
      comparable: false,
      incomparableReason: "INSUFFICIENT_COVERAGE",
      referenceCoverage: { total: 4, exact: 1, fuzzy: 0, ambiguous: 0, unmatched: 3 },
      editableCoverage: { total: 4, exact: 1, fuzzy: 0, ambiguous: 0, unmatched: 3 },
      exactPairs: [pair("r-1", "e-1")],
      fuzzyPairs: [],
      ambiguous: [],
      unmatchedReference: [
        { documentId: referenceDocumentId, noteId: "r-2" },
        { documentId: referenceDocumentId, noteId: "r-3" },
        { documentId: referenceDocumentId, noteId: "r-4" },
      ],
      unmatchedEditable: [
        { documentId: editableDocumentId, noteId: "e-2" },
        { documentId: editableDocumentId, noteId: "e-3" },
        { documentId: editableDocumentId, noteId: "e-4" },
      ],
    };

    expect(
      diffCrossImportAssignments(
        side(referenceDocumentId, { "r-1": "lead", "r-2": "lead", "r-3": "bass", "r-4": "bass" }),
        side(editableDocumentId, {
          "e-1": "voice-7",
          "e-2": "voice-7",
          "e-3": "voice-8",
          "e-4": "voice-8",
        }),
        result,
      ),
    ).toMatchObject({
      comparable: false,
      reason: "INSUFFICIENT_MATCHER_COVERAGE",
      trustedPairCoverage: { reference: 0, editable: 0 },
    });
  });

  it("requires at least fifty percent individually trusted pairs on both sides", () => {
    const diff = diffCrossImportAssignments(
      side(referenceDocumentId, { "r-1": "lead", "r-2": "lead", "r-3": "bass", "r-4": "bass" }),
      side(editableDocumentId, {
        "e-1": "voice-7",
        "e-2": "voice-7",
        "e-3": "voice-8",
        "e-4": "voice-8",
      }),
      matchingResult({
        referenceCoverage: { total: 4, exact: 1, fuzzy: 0, ambiguous: 3, unmatched: 0 },
        editableCoverage: { total: 4, exact: 1, fuzzy: 0, ambiguous: 3, unmatched: 0 },
        exactPairs: [pair("r-1", "e-1")],
      }),
    );

    expect(diff).toMatchObject({
      comparable: false,
      reason: "INSUFFICIENT_UNAMBIGUOUS_PAIRS",
      trustedPairCoverage: { reference: 0.25, editable: 0.25 },
    });
  });

  it("normalizes pair and diagnostic order before exposing cross-import output", () => {
    const reference = side(referenceDocumentId, { "r-1": "lead", "r-2": "lead", "r-3": "bass" });
    const editable = side(editableDocumentId, {
      "e-1": "voice-7",
      "e-2": "voice-8",
      "e-3": "voice-8",
    });
    const matcher = matchingResult({
      exactPairs: [pair("r-3", "e-3"), pair("r-2", "e-2"), pair("r-1", "e-1")],
      unmatchedReference: [{ documentId: referenceDocumentId, noteId: "r-z" }],
      unmatchedEditable: [{ documentId: editableDocumentId, noteId: "e-z" }],
    });

    const reversed = matchingResult({
      ...matcher,
      exactPairs: [...matcher.exactPairs].reverse(),
      unmatchedReference: [...matcher.unmatchedReference].reverse(),
      unmatchedEditable: [...matcher.unmatchedEditable].reverse(),
    });

    expect(diffCrossImportAssignments(reference, editable, matcher)).toEqual(
      diffCrossImportAssignments(reference, editable, reversed),
    );
  });
});

describe("changedNoteIdsForSide", () => {
  it("returns no local IDs for an incomparable result", () => {
    const diff: CrossImportDiff = {
      comparable: false,
      reason: "INSUFFICIENT_MATCHER_COVERAGE",
      matcher: {
        matcherVersion: 1,
        policy: "CROSS_IMPORT_V1",
        referenceCoverage: { total: 1, exact: 0, fuzzy: 0, ambiguous: 0, unmatched: 1 },
        editableCoverage: { total: 1, exact: 0, fuzzy: 0, ambiguous: 0, unmatched: 1 },
        exactPairCount: 0,
        fuzzyPairCount: 0,
      },
      trustedPairCoverage: { reference: 0, editable: 0 },
    };

    expect(
      changedNoteIdsForSide(diff, { documentId: editableDocumentId, side: "editable" }),
    ).toEqual([]);
  });
});
