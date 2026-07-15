import { describe, expect, it } from "vitest";
import type { RoundTripVerificationReport } from "../../lib/tauri/commands";
import { presentExportVerification } from "./exportVerificationPresentation";

const report: RoundTripVerificationReport = {
  verifierVersion: 1,
  matcherVersion: 1,
  policy: "STRICT_ROUND_TRIP_V1",
  status: "VERIFIED",
  noteSummary: {
    expectedNoteCount: 2,
    reimportedNoteCount: 2,
    exactMatchMultiplicity: 2,
    contentPreserved: true,
    ambiguousExactGroupCount: 0,
    missingExpected: [],
    unexpectedReimported: [],
  },
  voicePartition: {
    unambiguousPairCount: 2,
    ambiguousDuplicateGroupCount: 0,
    comparable: true,
    preserved: true,
  },
  metadata: {
    ppqPreserved: true,
    durationPreserved: true,
    tempoMapPreserved: true,
    timeSignaturesPreserved: true,
  },
  differences: [],
};

describe("presentExportVerification", () => {
  it("uses a constrained application-model claim for a verified report", () => {
    expect(presentExportVerification(report)).toMatchObject({
      tone: "success",
      heading: "Verified application model",
      retryExportSuggestion: null,
      noteContent:
        "Note content: preserved (2 expected, 2 reimported, 2 exact-match multiplicity).",
      voicePartition: "Voice partition: preserved (2 unambiguous pairs).",
      metadata: "Timeline metadata: PPQ, duration, tempo map, and time signatures preserved.",
      differenceSummary: null,
    });
  });

  it("makes differences and incomplete duplicate partitions specific without claiming a failed write", () => {
    const presentation = presentExportVerification({
      ...report,
      status: "INCONCLUSIVE",
      voicePartition: {
        unambiguousPairCount: 0,
        ambiguousDuplicateGroupCount: 1,
        comparable: false,
        preserved: false,
      },
      metadata: { ...report.metadata, tempoMapPreserved: false },
      differences: [
        {
          kind: "AMBIGUOUS_DUPLICATE_PARTITION",
          expectedNotes: [],
          reimportedNotes: [],
          expectedVoiceId: null,
          reimportedVoiceId: null,
        },
        {
          kind: "TEMPO_MAP",
          expectedNotes: [],
          reimportedNotes: [],
          expectedVoiceId: null,
          reimportedVoiceId: null,
        },
      ],
    });

    expect(presentation).toMatchObject({
      tone: "warning",
      heading: "Inconclusive application-model verification",
      voicePartition:
        "Voice partition: not fully comparable (0 unambiguous pairs; 1 ambiguous duplicate group).",
      metadata: "Timeline metadata differs: tempo map.",
      differenceSummary: "2 reported difference categories.",
      differenceKinds: ["Ambiguous duplicate partition", "Tempo map"],
    });
  });

  it("keeps a failed readback distinct from differences in a written file", () => {
    expect(presentExportVerification({ ...report, status: "COULD_NOT_VERIFY" })).toMatchObject({
      tone: "danger",
      heading: "Could not verify written file",
      summary: "The export was written, but its exact bytes could not be verified.",
      retryExportSuggestion:
        "Try exporting again after checking that the destination remains readable.",
    });
  });
});
