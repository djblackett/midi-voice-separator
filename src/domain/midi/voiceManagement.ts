import type { MidiNote, MidiVoice } from "./midiProject";
import type { VoiceOverrides } from "./voiceAssignments";

const VOICE_ID_PREFIX = "voice-";

export function nextVoiceId(voiceOrder: readonly string[]): string {
  const usedNumbers = voiceOrder
    .map((voiceId) => Number.parseInt(voiceId.replace(VOICE_ID_PREFIX, ""), 10))
    .filter((voiceNumber) => Number.isFinite(voiceNumber));
  const nextNumber = usedNumbers.length > 0 ? Math.max(...usedNumbers) + 1 : 1;
  return `${VOICE_ID_PREFIX}${nextNumber}`;
}

export function buildVoiceList(
  voiceOrder: readonly string[],
  voiceLabels: Readonly<Record<string, string>>,
  notes: readonly MidiNote[],
): MidiVoice[] {
  return voiceOrder.map((voiceId, index) => {
    const voiceNotes = notes.filter((note) => note.voiceId === voiceId);
    const pitches = voiceNotes.map((note) => note.pitch);

    return {
      id: voiceId,
      label: voiceLabels[voiceId] ?? `Voice ${index + 1}`,
      noteCount: voiceNotes.length,
      lowestPitch: pitches.length > 0 ? Math.min(...pitches) : 0,
      highestPitch: pitches.length > 0 ? Math.max(...pitches) : 0,
    };
  });
}

export function mergeVoiceOrder(
  voiceOrder: readonly string[],
  noteVoiceIds: Iterable<string>,
): string[] {
  const existing = new Set(voiceOrder);
  const newIds = Array.from(new Set(noteVoiceIds)).filter((voiceId) => !existing.has(voiceId));
  newIds.sort(
    (left, right) =>
      Number.parseInt(left.replace(VOICE_ID_PREFIX, ""), 10) -
      Number.parseInt(right.replace(VOICE_ID_PREFIX, ""), 10),
  );
  return [...voiceOrder, ...newIds];
}

export function mergeVoiceOverrides(
  notes: readonly MidiNote[],
  fromVoiceId: string,
  toVoiceId: string,
): VoiceOverrides {
  const overrides: VoiceOverrides = {};
  for (const note of notes) {
    if (note.voiceId === fromVoiceId) {
      overrides[note.id] = toVoiceId;
    }
  }
  return overrides;
}
