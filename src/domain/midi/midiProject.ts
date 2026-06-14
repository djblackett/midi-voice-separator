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
}

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
