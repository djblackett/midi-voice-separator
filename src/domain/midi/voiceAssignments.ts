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

/**
 * The materialized (displayed) voice assignment for every note: the override
 * if one exists, otherwise the note's own `voiceId`. This is the same
 * composition `applyVoiceOverrides` uses, extracted as a plain id->id map --
 * the single basis any assignment comparison (e.g. `assignmentDiff.ts`)
 * should use, never the raw project or the override map alone.
 */
export function materializeAssignments(
  project: MidiProject,
  overrides: VoiceOverrides,
): ReadonlyMap<string, string> {
  const assignments = new Map<string, string>();
  for (const note of project.notes) {
    assignments.set(note.id, overrides[note.id] ?? note.voiceId);
  }
  return assignments;
}

export function voiceIdForNumber(project: MidiProject | null, voiceNumber: number): string | null {
  if (!project || !Number.isInteger(voiceNumber) || voiceNumber < 1) {
    return null;
  }

  return project.voices[voiceNumber - 1]?.id ?? null;
}
