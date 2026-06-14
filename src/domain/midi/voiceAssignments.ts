import type { MidiProject, MidiVoice } from "./midiProject";

export type VoiceOverrides = Record<string, string>;

export function applyVoiceOverrides(project: MidiProject, overrides: VoiceOverrides): MidiProject {
  const notes = project.notes.map((note) => ({
    ...note,
    voiceId: overrides[note.id] ?? note.voiceId,
  }));

  return {
    ...project,
    notes,
    voices: recomputeVoiceSummaries(project.voices, notes),
  };
}

export function voiceIdForNumber(project: MidiProject | null, voiceNumber: number): string | null {
  if (!project || !Number.isInteger(voiceNumber) || voiceNumber < 1) {
    return null;
  }

  return project.voices[voiceNumber - 1]?.id ?? null;
}

function recomputeVoiceSummaries(
  originalVoices: MidiVoice[],
  notes: MidiProject["notes"],
): MidiVoice[] {
  return originalVoices.map((voice) => {
    const voiceNotes = notes.filter((note) => note.voiceId === voice.id);
    if (voiceNotes.length === 0) {
      return {
        ...voice,
        noteCount: 0,
      };
    }

    const pitches = voiceNotes.map((note) => note.pitch);
    return {
      ...voice,
      noteCount: voiceNotes.length,
      lowestPitch: Math.min(...pitches),
      highestPitch: Math.max(...pitches),
    };
  });
}
