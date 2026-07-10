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

export interface AssignmentMetricSubject {
  ppq: number;
  notes: readonly MidiNote[];
}

export type UnsupportedAssignmentCostReason =
  | "METRIC_MISMATCH"
  | "PROFILE_MISMATCH"
  | "NOTE_UNIVERSE_MISMATCH"
  | "HARD_VIOLATIONS"
  | "MELODIC_VOICE_COUNT_MISMATCH";

export type AssignmentCostComparison =
  | { status: "LOWER_TARGET"; delta: number }
  | { status: "LOWER_CURRENT"; delta: number }
  | { status: "TIED" }
  | { status: "UNSUPPORTED"; reason: UnsupportedAssignmentCostReason };

interface RationalTick {
  numerator: number;
  denominator: number;
}

interface NoteUniverseAtom {
  id: string;
  pitch: number;
  channel: number;
  velocity: number;
  start: RationalTick;
  end: RationalTick;
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a || 1;
}

function rationalTick(tick: number, ppq: number): RationalTick {
  const divisor = greatestCommonDivisor(tick, ppq);
  return { numerator: tick / divisor, denominator: ppq / divisor };
}

function canonicalNoteUniverse(subject: AssignmentMetricSubject): NoteUniverseAtom[] | null {
  if (!Number.isInteger(subject.ppq) || subject.ppq <= 0) {
    return null;
  }
  return subject.notes
    .map((note) => ({
      id: note.id,
      pitch: note.pitch,
      channel: note.channel,
      velocity: note.velocity,
      start: rationalTick(note.startTick, subject.ppq),
      end: rationalTick(note.endTick, subject.ppq),
    }))
    .sort((left, right) => {
      const idOrder = left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
      return (
        idOrder ||
        left.pitch - right.pitch ||
        left.channel - right.channel ||
        left.velocity - right.velocity ||
        left.start.numerator - right.start.numerator ||
        left.start.denominator - right.start.denominator ||
        left.end.numerator - right.end.numerator ||
        left.end.denominator - right.end.denominator
      );
    });
}

export function haveSameAssignmentNoteUniverse(
  target: AssignmentMetricSubject,
  current: AssignmentMetricSubject,
): boolean {
  const targetAtoms = canonicalNoteUniverse(target);
  const currentAtoms = canonicalNoteUniverse(current);
  if (!targetAtoms || !currentAtoms || targetAtoms.length !== currentAtoms.length) {
    return false;
  }
  return targetAtoms.every((targetAtom, index) => {
    const currentAtom = currentAtoms[index];
    return (
      targetAtom.id === currentAtom.id &&
      targetAtom.pitch === currentAtom.pitch &&
      targetAtom.channel === currentAtom.channel &&
      targetAtom.velocity === currentAtom.velocity &&
      targetAtom.start.numerator === currentAtom.start.numerator &&
      targetAtom.start.denominator === currentAtom.start.denominator &&
      targetAtom.end.numerator === currentAtom.end.numerator &&
      targetAtom.end.denominator === currentAtom.end.denominator
    );
  });
}

export function compareAssignmentModelCosts(
  targetSubject: AssignmentMetricSubject,
  currentSubject: AssignmentMetricSubject,
  targetReport: AssignmentMetricReport,
  currentReport: AssignmentMetricReport,
): AssignmentCostComparison {
  if (
    targetReport.metric.id !== currentReport.metric.id ||
    targetReport.metric.version !== currentReport.metric.version
  ) {
    return { status: "UNSUPPORTED", reason: "METRIC_MISMATCH" };
  }
  if (
    targetReport.profile.id !== currentReport.profile.id ||
    targetReport.profile.version !== currentReport.profile.version
  ) {
    return { status: "UNSUPPORTED", reason: "PROFILE_MISMATCH" };
  }
  if (!haveSameAssignmentNoteUniverse(targetSubject, currentSubject)) {
    return { status: "UNSUPPORTED", reason: "NOTE_UNIVERSE_MISMATCH" };
  }
  if (targetReport.hardViolations.length > 0 || currentReport.hardViolations.length > 0) {
    return { status: "UNSUPPORTED", reason: "HARD_VIOLATIONS" };
  }
  if (targetReport.melodicVoiceCount !== currentReport.melodicVoiceCount) {
    return { status: "UNSUPPORTED", reason: "MELODIC_VOICE_COUNT_MISMATCH" };
  }
  if (targetReport.totalCost === currentReport.totalCost) {
    return { status: "TIED" };
  }
  return targetReport.totalCost < currentReport.totalCost
    ? { status: "LOWER_TARGET", delta: currentReport.totalCost - targetReport.totalCost }
    : { status: "LOWER_CURRENT", delta: targetReport.totalCost - currentReport.totalCost };
}
