import {
  LOW_CONFIDENCE_THRESHOLD,
  STRATEGY_LABELS,
  type MidiNote,
  type MidiProject,
} from "./midiProject";
import type { VoiceOverrides } from "./voiceAssignments";
import { nextVoiceId } from "./voiceManagement";

export const WIDE_PITCH_SPAN_SEMITONES = 36;
export const LARGE_LEAP_SEMITONES = 12;
export const HIGH_LARGE_LEAP_RATIO = 0.08;
export const HIGH_LOW_CONFIDENCE_RATIO = 0.18;
export const SIGNIFICANT_CHANNEL_RATIO = 0.05;
export const DOMINANT_CHANNEL_RATIO = 0.6;
export const POLYPHONY_CAP_PRESSURE_RATIO = 1.5;

export interface VoiceDiagnostic {
  voiceId: string;
  label: string;
  noteCount: number;
  minPitch: number;
  maxPitch: number;
  pitchSpan: number;
  channelDistribution: Record<number, number>;
  lowConfidenceNoteCount: number;
  forcedCapNoteCount: number;
  largeLeapCount: number;
  suspiciousReasons: string[];
  suspicious: boolean;
}

export interface SplitVoiceByPitchRepair {
  sourceVoiceId: string;
  newVoiceId: string;
  threshold: number;
  overrides: VoiceOverrides;
  movedNoteIds: string[];
  voiceOrder: string[];
}

export interface SeparationRecommendation {
  message: string;
  maxPolyphony: number;
}

export function noteIdsForVoice(notes: readonly MidiNote[], voiceId: string): string[] {
  return notes.filter((note) => note.voiceId === voiceId).map((note) => note.id);
}

function notesByVoice(notes: readonly MidiNote[]): Map<string, MidiNote[]> {
  const grouped = new Map<string, MidiNote[]>();
  for (const note of notes) {
    const voiceNotes = grouped.get(note.voiceId) ?? [];
    voiceNotes.push(note);
    grouped.set(note.voiceId, voiceNotes);
  }
  return grouped;
}

function countLargeLeaps(notes: readonly MidiNote[]): number {
  const sorted = [...notes].sort(
    (left, right) => left.startTick - right.startTick || left.endTick - right.endTick,
  );
  let count = 0;
  for (let index = 1; index < sorted.length; index += 1) {
    if (Math.abs(sorted[index].pitch - sorted[index - 1].pitch) > LARGE_LEAP_SEMITONES) {
      count += 1;
    }
  }
  return count;
}

function channelDistribution(notes: readonly MidiNote[]): Record<number, number> {
  const distribution: Record<number, number> = {};
  for (const note of notes) {
    distribution[note.channel] = (distribution[note.channel] ?? 0) + 1;
  }
  return distribution;
}

function suspiciousReasonsFor(
  diagnostic: Omit<VoiceDiagnostic, "suspiciousReasons" | "suspicious">,
): string[] {
  const reasons: string[] = [];
  if (diagnostic.pitchSpan >= WIDE_PITCH_SPAN_SEMITONES) {
    reasons.push(`span ${diagnostic.pitchSpan} semitones`);
  }
  if (
    diagnostic.noteCount > 0 &&
    diagnostic.largeLeapCount / diagnostic.noteCount >= HIGH_LARGE_LEAP_RATIO
  ) {
    reasons.push(`${diagnostic.largeLeapCount} large leaps`);
  }
  if (diagnostic.forcedCapNoteCount > 0) {
    reasons.push(`${diagnostic.forcedCapNoteCount} cap-forced notes`);
  }
  if (
    diagnostic.noteCount > 0 &&
    diagnostic.lowConfidenceNoteCount / diagnostic.noteCount >= HIGH_LOW_CONFIDENCE_RATIO
  ) {
    reasons.push(`${diagnostic.lowConfidenceNoteCount} low-confidence notes`);
  }
  return reasons;
}

export function analyzeVoiceDiagnostics(
  project: Pick<MidiProject, "notes" | "voices">,
): VoiceDiagnostic[] {
  const groupedNotes = notesByVoice(project.notes);

  return project.voices.map((voice) => {
    const voiceNotes = groupedNotes.get(voice.id) ?? [];
    const pitches = voiceNotes.map((note) => note.pitch);
    const minPitch = pitches.length > 0 ? Math.min(...pitches) : voice.lowestPitch;
    const maxPitch = pitches.length > 0 ? Math.max(...pitches) : voice.highestPitch;
    const baseDiagnostic = {
      voiceId: voice.id,
      label: voice.label,
      noteCount: voiceNotes.length,
      minPitch,
      maxPitch,
      pitchSpan: voiceNotes.length > 0 ? maxPitch - minPitch : 0,
      channelDistribution: channelDistribution(voiceNotes),
      lowConfidenceNoteCount: voiceNotes.filter(
        (note) => note.assignmentConfidence < LOW_CONFIDENCE_THRESHOLD,
      ).length,
      forcedCapNoteCount: voiceNotes.filter((note) => note.assignmentReason === "VOICE_CAP_REACHED")
        .length,
      largeLeapCount: countLargeLeaps(voiceNotes),
    };
    const suspiciousReasons = suspiciousReasonsFor(baseDiagnostic);
    return {
      ...baseDiagnostic,
      suspiciousReasons,
      suspicious: suspiciousReasons.length > 0,
    };
  });
}

export function sortVoiceDiagnosticsForDisplay(
  diagnostics: readonly VoiceDiagnostic[],
): VoiceDiagnostic[] {
  return [...diagnostics].sort((left, right) => {
    if (left.suspicious !== right.suspicious) {
      return left.suspicious ? -1 : 1;
    }
    return right.pitchSpan - left.pitchSpan || right.noteCount - left.noteCount;
  });
}

export function formatVoiceDiagnosticSummary(diagnostic: VoiceDiagnostic): string {
  return `${diagnostic.label}: ${diagnostic.noteCount} notes, span ${diagnostic.pitchSpan} semitones, ${diagnostic.largeLeapCount} large leaps, ${diagnostic.lowConfidenceNoteCount} low-confidence notes`;
}

export function buildSplitVoiceByPitchRepair(
  notes: readonly MidiNote[],
  voiceOrder: readonly string[],
  sourceVoiceId: string,
  threshold?: number,
): SplitVoiceByPitchRepair | null {
  const sourceNotes = notes.filter((note) => note.voiceId === sourceVoiceId);
  if (sourceNotes.length < 2) {
    return null;
  }

  const pitches = sourceNotes.map((note) => note.pitch);
  const splitThreshold = threshold ?? Math.floor((Math.min(...pitches) + Math.max(...pitches)) / 2);
  const movedNotes = sourceNotes.filter((note) => note.pitch > splitThreshold);
  if (movedNotes.length === 0 || movedNotes.length === sourceNotes.length) {
    return null;
  }

  const newVoiceId = nextVoiceId(voiceOrder);
  const overrides: VoiceOverrides = {};
  for (const note of movedNotes) {
    overrides[note.id] = newVoiceId;
  }

  return {
    sourceVoiceId,
    newVoiceId,
    threshold: splitThreshold,
    overrides,
    movedNoteIds: movedNotes.map((note) => note.id),
    voiceOrder: [...voiceOrder, newVoiceId],
  };
}

export function maxSimultaneousPolyphony(notes: readonly MidiNote[]): number {
  const events = notes.flatMap((note) => [
    { tick: note.startTick, delta: 1 },
    { tick: Math.max(note.endTick, note.startTick + 1), delta: -1 },
  ]);
  events.sort((left, right) => left.tick - right.tick || left.delta - right.delta);

  let active = 0;
  let maxActive = 0;
  for (const event of events) {
    active += event.delta;
    maxActive = Math.max(maxActive, active);
  }
  return maxActive;
}

function projectChannelStats(notes: readonly MidiNote[]) {
  const distribution = channelDistribution(notes);
  const total = notes.length;
  const counts = Object.values(distribution);
  const dominantCount = counts.length > 0 ? Math.max(...counts) : 0;
  const significantChannelCount = counts.filter(
    (count) => total > 0 && count / total >= SIGNIFICANT_CHANNEL_RATIO,
  ).length;

  return {
    dominantRatio: total > 0 ? dominantCount / total : 0,
    significantChannelCount,
  };
}

export function recommendSeparationAction(
  project: Pick<MidiProject, "notes" | "strategySuggestion">,
  diagnostics: readonly VoiceDiagnostic[],
  selectedMaxVoiceCount?: number,
): SeparationRecommendation {
  const maxPolyphony = maxSimultaneousPolyphony(project.notes);
  if (
    selectedMaxVoiceCount !== undefined &&
    maxPolyphony > selectedMaxVoiceCount * POLYPHONY_CAP_PRESSURE_RATIO
  ) {
    return {
      maxPolyphony,
      message: `Max polyphony reaches ${maxPolyphony}, well above the selected cap of ${selectedMaxVoiceCount}; raise the cap or expect unrelated notes to share voices.`,
    };
  }

  const wideSuspiciousCount = diagnostics.filter(
    (diagnostic) => diagnostic.suspicious && diagnostic.pitchSpan >= WIDE_PITCH_SPAN_SEMITONES,
  ).length;
  if (wideSuspiciousCount >= 2) {
    return {
      maxPolyphony,
      message:
        "Several voices span wide pitch ranges; try Register priority, then apply pitch ranges or split the worst voice by pitch.",
    };
  }

  const { dominantRatio, significantChannelCount } = projectChannelStats(project.notes);
  if (dominantRatio >= DOMINANT_CHANNEL_RATIO) {
    return {
      maxPolyphony,
      message:
        "One channel contains most notes, so Strict Channel is unlikely to help; try Global + Register priority or Contig + Register priority.",
    };
  }

  if (significantChannelCount >= 2) {
    return {
      maxPolyphony,
      message:
        "Channels look reasonably separated; try Channel priority or Strict channel if track/channel identity matches instruments.",
    };
  }

  const importedSuggestion = STRATEGY_LABELS[project.strategySuggestion.strategy];
  return {
    maxPolyphony,
    message: `No single red flag dominates; start with the imported suggestion (${importedSuggestion}) and split any voice that is visibly mixed.`,
  };
}
