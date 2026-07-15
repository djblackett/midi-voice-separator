import type {
  RoundTripDifferenceKind,
  RoundTripVerificationReport,
} from "../../lib/tauri/commands";

export type ExportVerificationTone = "success" | "warning" | "danger";

export interface ExportVerificationPresentation {
  readonly tone: ExportVerificationTone;
  readonly heading: string;
  readonly summary: string;
  readonly noteContent: string;
  readonly voicePartition: string;
  readonly metadata: string;
  readonly differenceSummary: string | null;
  readonly differenceKinds: readonly string[];
  readonly retryExportSuggestion: string | null;
}

const DIFFERENCE_LABEL: Readonly<Record<RoundTripDifferenceKind, string>> = {
  MISSING_NOTE: "Missing notes",
  UNEXPECTED_NOTE: "Unexpected notes",
  AMBIGUOUS_DUPLICATE_PARTITION: "Ambiguous duplicate partition",
  VOICE_PARTITION: "Voice partition",
  VOICE_LABEL: "Voice labels",
  VOICE_ROLE: "Voice roles",
  PPQ: "PPQ",
  DURATION: "Duration",
  TEMPO_MAP: "Tempo map",
  TIME_SIGNATURES: "Time signatures",
  OVERLAPPING_DUPLICATE_PAIRING: "Overlapping duplicate-note pairing",
};

function plural(count: number, singular: string, pluralForm = singular + "s"): string {
  return count === 1 ? singular : pluralForm;
}

function formatMetadata(report: RoundTripVerificationReport): string {
  const preserved = [
    ["PPQ", report.metadata.ppqPreserved],
    ["duration", report.metadata.durationPreserved],
    ["tempo map", report.metadata.tempoMapPreserved],
    ["time signatures", report.metadata.timeSignaturesPreserved],
  ];
  const missing = preserved.filter(([, isPreserved]) => !isPreserved).map(([label]) => label);

  return missing.length === 0
    ? "Timeline metadata: PPQ, duration, tempo map, and time signatures preserved."
    : "Timeline metadata differs: " + missing.join(", ") + ".";
}

function formatVoicePartition(report: RoundTripVerificationReport): string {
  const { voicePartition } = report;
  const pairLabel =
    voicePartition.unambiguousPairCount +
    " unambiguous " +
    plural(voicePartition.unambiguousPairCount, "pair");
  const ambiguityLabel =
    voicePartition.ambiguousDuplicateGroupCount === 0
      ? ""
      : "; " +
        voicePartition.ambiguousDuplicateGroupCount +
        " ambiguous duplicate " +
        plural(voicePartition.ambiguousDuplicateGroupCount, "group");

  if (!voicePartition.comparable) {
    return "Voice partition: not fully comparable (" + pairLabel + ambiguityLabel + ").";
  }
  return (
    "Voice partition: " +
    (voicePartition.preserved ? "preserved" : "differences found") +
    " (" +
    pairLabel +
    ambiguityLabel +
    ")."
  );
}

function formatDifferenceKinds(report: RoundTripVerificationReport): readonly string[] {
  return Array.from(
    new Set(report.differences.map((difference) => DIFFERENCE_LABEL[difference.kind])),
  );
}

export function presentExportVerification(
  report: RoundTripVerificationReport,
): ExportVerificationPresentation {
  const status =
    report.status === "VERIFIED"
      ? {
          tone: "success" as const,
          heading: "Verified application model",
          summary: "The written file preserved the modeled MIDI data.",
          retryExportSuggestion: null,
        }
      : report.status === "DIFFERENCES_FOUND"
        ? {
            tone: "warning" as const,
            heading: "Differences found",
            summary: "The written file differs in supported application-model data.",
            retryExportSuggestion: null,
          }
        : report.status === "INCONCLUSIVE"
          ? {
              tone: "warning" as const,
              heading: "Inconclusive application-model verification",
              summary: "The verifier could not make a complete application-model claim.",
              retryExportSuggestion: null,
            }
          : {
              tone: "danger" as const,
              heading: "Could not verify written file",
              summary: "The export was written, but its exact bytes could not be verified.",
              retryExportSuggestion:
                "Try exporting again after checking that the destination remains readable.",
            };
  const differenceKinds = formatDifferenceKinds(report);

  return {
    ...status,
    noteContent:
      "Note content: " +
      (report.noteSummary.contentPreserved ? "preserved" : "differences found") +
      " (" +
      report.noteSummary.expectedNoteCount +
      " expected, " +
      report.noteSummary.reimportedNoteCount +
      " reimported, " +
      report.noteSummary.exactMatchMultiplicity +
      " exact-match multiplicity).",
    voicePartition: formatVoicePartition(report),
    metadata: formatMetadata(report),
    differenceSummary:
      differenceKinds.length === 0
        ? null
        : differenceKinds.length +
          " reported " +
          plural(differenceKinds.length, "difference category", "difference categories") +
          ".",
    differenceKinds,
    retryExportSuggestion: status.retryExportSuggestion,
  };
}
