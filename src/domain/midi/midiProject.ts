export interface MidiProject {
  fileName: string;
  format: string;
  ppq: number;
  durationTicks: number;
  trackCount: number;
  voices: MidiVoice[];
  notes: MidiNote[];
  tempoChanges: TempoChange[];
  timeSignatures: TimeSignature[];
  warnings: MidiWarning[];
  separationSummary: SeparationSummary;
}

export type AssignmentReason =
  | "IMPORTED"
  | "CHANNEL_CONTINUITY"
  | "CLOSEST_PITCH"
  | "NEW_VOICE_NO_FIT";

// Mirrors the Rust heuristic's LOW_CONFIDENCE_THRESHOLD. Kept as the single
// frontend source of truth for "is this note flagged for review" so the
// dashed canvas outline and the review-mode queue always agree.
export const LOW_CONFIDENCE_THRESHOLD = 0.5;

export interface MidiNote {
  id: string;
  voiceId: string;
  sourceTrackIndex: number;
  channel: number;
  pitch: number;
  velocity: number;
  startTick: number;
  endTick: number;
  durationTicks: number;
  assignmentConfidence: number;
  assignmentReason: AssignmentReason;
}

export interface SeparationSummary {
  meanConfidence: number;
  lowConfidenceNoteCount: number;
  voiceCount: number;
}

export interface MidiVoice {
  id: string;
  label: string;
  noteCount: number;
  lowestPitch: number;
  highestPitch: number;
}

export interface TempoChange {
  tick: number;
  microsecondsPerQuarter: number;
}

export interface TimeSignature {
  tick: number;
  numerator: number;
  denominator: number;
}

export interface MidiWarning {
  code: string;
  message: string;
  trackIndex: number | null;
  tick: number | null;
}

export function formatProjectSummary(project: MidiProject | null): string {
  if (!project) {
    return "Notes: 0 | Voices: 0 | Tracks: 0 | PPQ: - | Duration: 0 ticks | Tempo changes: 0 | Time signatures: 0";
  }

  return `Notes: ${project.notes.length} | Voices: ${project.voices.length} | Tracks: ${project.trackCount} | PPQ: ${project.ppq} | Duration: ${project.durationTicks} ticks | Tempo changes: ${project.tempoChanges.length} | Time signatures: ${project.timeSignatures.length}`;
}

export function formatMidiWarningLocation(warning: MidiWarning): string {
  const parts = [];

  if (warning.trackIndex !== null) {
    parts.push(`track ${warning.trackIndex}`);
  }

  if (warning.tick !== null) {
    parts.push(`tick ${warning.tick}`);
  }

  return parts.length > 0 ? parts.join(", ") : "unknown location";
}

export function formatMidiChannel(channel: number): string {
  return `Channel ${channel + 1}`;
}

export function formatSelectedNote(note: MidiNote | null): string {
  if (!note) {
    return "No note selected";
  }

  return `Pitch ${note.pitch} | ${formatMidiChannel(note.channel)} | ${note.startTick}-${note.endTick} ticks | ${note.voiceId}`;
}

const PITCH_CLASS_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

/** MIDI pitch to scientific pitch notation, e.g. 60 -> "C4" (middle C). */
export function formatPitchName(pitch: number): string {
  const octave = Math.floor(pitch / 12) - 1;
  return `${PITCH_CLASS_NAMES[((pitch % 12) + 12) % 12]}${octave}`;
}

/** A short piano-roll hover-tooltip summary for a single note. */
export function formatNoteTooltip(note: MidiNote, voices: readonly MidiVoice[]): string {
  const voice = voices.find((candidate) => candidate.id === note.voiceId);
  const confidencePercent = Math.round(note.assignmentConfidence * 100);

  return `${formatPitchName(note.pitch)} (${note.pitch}) · ${voice?.label ?? note.voiceId} · ${confidencePercent}% confidence · ticks ${note.startTick}-${note.endTick}`;
}

export function formatSeparationSummary(summary: SeparationSummary, noteCount: number): string {
  if (noteCount === 0) {
    return "No notes to separate.";
  }

  const highConfidencePercent = Math.round(summary.meanConfidence * 100);

  return summary.lowConfidenceNoteCount > 0
    ? `${highConfidencePercent}% mean assignment confidence — ${summary.lowConfidenceNoteCount} note${summary.lowConfidenceNoteCount === 1 ? "" : "s"} flagged for review.`
    : `${highConfidencePercent}% mean assignment confidence — no notes flagged for review.`;
}

export function formatSelectionSummary(notes: MidiNote[]): string {
  if (notes.length === 0) {
    return "No note selected";
  }

  const pitches = notes.map((note) => note.pitch);
  const voiceCount = new Set(notes.map((note) => note.voiceId)).size;

  return `${notes.length} notes selected | ${voiceCount} voice${voiceCount === 1 ? "" : "s"} | pitches ${Math.min(...pitches)}-${Math.max(...pitches)}`;
}
