import type { MidiNote } from "./midiProject";

export interface AssignmentMetricRef {
  id: "ASSIGNMENT_MODEL_COST";
  version: number;
}

export interface EvaluationProfileRef {
  id: "GENERAL_PURPOSE";
  version: number;
}

export const GENERAL_PURPOSE_EVALUATION_PROFILE: EvaluationProfileRef = {
  id: "GENERAL_PURPOSE",
  version: 1,
};

export interface AssignmentEvaluationRequest {
  ppq: number;
  notes: MidiNote[];
  profile: EvaluationProfileRef;
}

export type AssignmentMetricComponentId =
  | "VOICE_COMPLEXITY"
  | "PITCH_MOTION"
  | "REGISTER_EXPANSION"
  | "SILENCE_GAP"
  | "CHANNEL_SWITCH"
  | "VOICE_CROSSING";

export type AssignmentMetricUnit =
  | "VOICES"
  | "SEMITONES"
  | "QUARTER_NOTES"
  | "TRANSITIONS"
  | "CROSSINGS";

export interface AssignmentMetricComponent {
  id: AssignmentMetricComponentId;
  rawValue: number;
  unit: AssignmentMetricUnit;
  weight: number;
  cost: number;
}

export type AssignmentHardViolationKind =
  | "INVALID_NOTE_SPAN"
  | "DUPLICATE_NOTE_ID"
  | "UNASSIGNED_MELODIC_NOTE"
  | "MELODIC_SAME_VOICE_OVERLAP";

export interface AssignmentHardViolation {
  kind: AssignmentHardViolationKind;
  occurrenceCount: number;
  affectedNoteIds: string[];
}

export interface AssignmentMetricReport {
  metric: AssignmentMetricRef;
  profile: EvaluationProfileRef;
  melodicNoteCount: number;
  excludedPercussionNoteCount: number;
  melodicVoiceCount: number;
  components: AssignmentMetricComponent[];
  totalCost: number;
  hardViolations: AssignmentHardViolation[];
}
