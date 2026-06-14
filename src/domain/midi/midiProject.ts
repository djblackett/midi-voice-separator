export interface MidiProject {
  fileName: string;
  format: string;
  ppq: number;
  durationTicks: number;
  trackCount: number;
  notes: MidiNote[];
  tempoChanges: TempoChange[];
  timeSignatures: TimeSignature[];
  warnings: MidiWarning[];
}

export interface MidiNote {
  id: string;
  sourceTrackIndex: number;
  channel: number;
  pitch: number;
  velocity: number;
  startTick: number;
  endTick: number;
  durationTicks: number;
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
    return "Notes: 0 | Tracks: 0 | PPQ: - | Duration: 0 ticks";
  }

  return `Notes: ${project.notes.length} | Tracks: ${project.trackCount} | PPQ: ${project.ppq} | Duration: ${project.durationTicks} ticks`;
}
