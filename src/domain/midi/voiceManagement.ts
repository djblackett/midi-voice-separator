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

/**
 * Reconciles the frontend's voice order against the result of a full
 * re-run: appends any brand-new voice ids (like `mergeVoiceOrder`), but
 * also drops ids no note is assigned to anymore. A re-run replaces the
 * entire project and decides its own voice structure, so a voice that
 * existed before but the heuristic no longer needs (e.g. after lowering
 * the max-voice-count cap) shouldn't linger in the legend as an empty
 * row forever — unlike `mergeVoiceOrder`'s append-only behavior, which
 * is correct for incremental corrections that never remove notes from a
 * voice wholesale.
 */
export function reconcileVoiceOrderAfterReassign(
  voiceOrder: readonly string[],
  noteVoiceIds: Iterable<string>,
): string[] {
  const present = new Set(noteVoiceIds);
  return mergeVoiceOrder(voiceOrder, present).filter((voiceId) => present.has(voiceId));
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
