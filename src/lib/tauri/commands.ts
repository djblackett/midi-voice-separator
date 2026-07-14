import { invoke } from "@tauri-apps/api/core";
import type { AssignmentProvenance } from "../../domain/midi/assignmentProvenance";
import type { MidiProject, SeparationStrategy } from "../../domain/midi/midiProject";
import type {
  AmbiguousCorrespondenceGroup,
  CorrespondenceNotePair,
  CrossImportMatchForConsumers,
} from "../../domain/midi/noteCorrespondence";
import type {
  AssignmentEvaluationRequest,
  AssignmentMetricReport,
} from "../../domain/midi/assignmentMetric";

const COMMANDS = {
  backendStatus: "backend_status",
  importMidi: "import_midi",
  compareExternalMidi: "compare_external_midi",
  exportMidi: "export_midi",
  reassignVoices: "reassign_voices",
  evaluateAssignment: "evaluate_assignment",
} as const;

export interface BackendStatus {
  status: "ready";
  application: string;
}

export interface AppCommandError {
  code: string;
  message: string;
}

export interface ExportMidiResult {
  path: string;
  trackCount: number;
  noteCount: number;
}

/** Result returned by import and rerun commands before B2 carries it on the document. */
export interface AssignmentOperationResult {
  project: MidiProject;
  provenance: AssignmentProvenance;
}

export interface CrossImportComparisonRequest {
  readonly referencePath: string;
  readonly referenceDocumentId: string;
  readonly editable: {
    readonly documentId: string;
    readonly project: MidiProject;
  };
}

export interface RationalQuarterDistance {
  readonly numerator: string;
  readonly denominator: string;
}

export interface CrossImportFuzzyNotePair extends CorrespondenceNotePair {
  readonly onsetDistance: RationalQuarterDistance;
  readonly durationDistance: RationalQuarterDistance;
  readonly sameChannel: boolean;
  readonly velocityDifference: number;
}

export interface CrossImportAmbiguityGroup extends AmbiguousCorrespondenceGroup {
  readonly matchedMultiplicity: number;
  readonly candidateCount: number;
}

/** Native Feature 7 result, enriched only with display-only fuzzy scores. */
export type CrossImportMatchResult = CrossImportMatchForConsumers & {
  readonly fuzzyPairs: readonly CrossImportFuzzyNotePair[];
  readonly ambiguous: readonly CrossImportAmbiguityGroup[];
};

export interface ExternalReferenceImportResult {
  readonly documentId: string;
  readonly path: string;
  readonly project: MidiProject;
  readonly provenance: AssignmentProvenance;
}

export interface CrossImportComparisonResponse {
  readonly reference: ExternalReferenceImportResult;
  readonly correspondence: CrossImportMatchResult;
}

// `SeparationStrategy` is a domain concept (it also appears in the
// imported project's strategy suggestion), so its definition lives in
// `midiProject.ts`; re-exported here so command callers keep one import
// site for command-related types.
export type { SeparationStrategy } from "../../domain/midi/midiProject";

/**
 * Selects which assignment algorithm scores/searches for a voice per note
 * -- orthogonal to `SeparationStrategy`, which only picks the cost
 * weighting either algorithm scores with. `GREEDY` commits each note to
 * its single cheapest compatible voice immediately, before the next note
 * is even known. `GLOBAL` buffers a short lookahead window of unlocked
 * notes and searches for the true minimum-cost grouping across that whole
 * window before committing any of them, which can find a better overall
 * split than greedy's note-at-a-time commitment allows, at the cost of
 * being slower on large files. `CONTIG` is a different algorithm family
 * (contig mapping): it segments the piece into spans of constant polyphony,
 * where voice-leading is unambiguous, and only makes real decisions where
 * those spans meet. See `AssignmentMode` in `model.rs`.
 */
export type AssignmentMode = "GREEDY" | "GLOBAL" | "CONTIG";

function toCommandError(error: unknown): AppCommandError {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    typeof error.code === "string" &&
    typeof error.message === "string"
  ) {
    return { code: error.code, message: error.message };
  }

  return {
    code: "UNKNOWN_ERROR",
    message: error instanceof Error ? error.message : "An unexpected application error occurred.",
  };
}

export async function getBackendStatus(): Promise<BackendStatus> {
  try {
    return await invoke<BackendStatus>(COMMANDS.backendStatus);
  } catch (error) {
    throw toCommandError(error);
  }
}

export async function importMidi(path: string): Promise<AssignmentOperationResult> {
  try {
    return await invoke<AssignmentOperationResult>(COMMANDS.importMidi, { path });
  } catch (error) {
    throw toCommandError(error);
  }
}

export async function compareExternalMidi(
  request: CrossImportComparisonRequest,
): Promise<CrossImportComparisonResponse> {
  try {
    return await invoke<CrossImportComparisonResponse>(COMMANDS.compareExternalMidi, { request });
  } catch (error) {
    throw toCommandError(error);
  }
}

export async function exportMidi(path: string, project: MidiProject): Promise<ExportMidiResult> {
  try {
    return await invoke<ExportMidiResult>(COMMANDS.exportMidi, { path, project });
  } catch (error) {
    throw toCommandError(error);
  }
}

export async function reassignVoices(
  project: MidiProject,
  locked: Record<string, string>,
  maxVoiceCount: number | undefined,
  strategy: SeparationStrategy,
  mode: AssignmentMode,
): Promise<AssignmentOperationResult> {
  try {
    return await invoke<AssignmentOperationResult>(COMMANDS.reassignVoices, {
      project,
      locked,
      maxVoiceCount: maxVoiceCount ?? null,
      strategy,
      mode,
    });
  } catch (error) {
    throw toCommandError(error);
  }
}

export async function evaluateAssignment(
  request: AssignmentEvaluationRequest,
): Promise<AssignmentMetricReport> {
  try {
    return await invoke<AssignmentMetricReport>(COMMANDS.evaluateAssignment, { request });
  } catch (error) {
    throw toCommandError(error);
  }
}
