import type { MidiProject } from "./midiProject";

export type VoiceOverrides = Record<string, string>;

export function applyVoiceOverrides(project: MidiProject, overrides: VoiceOverrides): MidiProject {
  const notes = project.notes.map((note) => ({
    ...note,
    voiceId: overrides[note.id] ?? note.voiceId,
  }));

  return {
    ...project,
    notes,
  };
}

export function voiceIdForNumber(project: MidiProject | null, voiceNumber: number): string | null {
  if (!project || !Number.isInteger(voiceNumber) || voiceNumber < 1) {
    return null;
  }

  return project.voices[voiceNumber - 1]?.id ?? null;
}
