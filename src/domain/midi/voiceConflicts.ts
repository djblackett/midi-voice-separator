import type { MidiNote } from "./midiProject";
import { PERCUSSION_VOICE_ID } from "./voiceManagement";

/**
 * Overlap-conflict detection: chiptune voices are monophonic, so two
 * notes sounding at the same time in the same voice is a real assignment
 * error the exporter can't represent faithfully. Pure and kept separate
 * from the canvas/App for the same unit-testability reason as
 * `reviewQueue.ts` (whose wrap-around stepping this module mirrors).
 */
export interface VoiceConflict {
  voiceId: string;
  /** The two overlapping notes, in start-tick order. */
  noteIds: [string, string];
  /** The overlap window, for time-sorted stepping and view panning. */
  startTick: number;
  endTick: number;
}

/**
 * Every same-voice overlapping note pair, sorted by where the overlap
 * starts. Notes that merely touch (one ends exactly where the next
 * starts) are legal monophony, not conflicts. The percussion voice is
 * exempt: simultaneous drum hits are normal there.
 */
export function findVoiceConflicts(notes: readonly MidiNote[]): VoiceConflict[] {
  const byVoice = new Map<string, MidiNote[]>();
  for (const note of notes) {
    if (note.voiceId === PERCUSSION_VOICE_ID) {
      continue;
    }
    const voiceNotes = byVoice.get(note.voiceId);
    if (voiceNotes) {
      voiceNotes.push(note);
    } else {
      byVoice.set(note.voiceId, [note]);
    }
  }

  const conflicts: VoiceConflict[] = [];
  for (const [voiceId, voiceNotes] of byVoice) {
    const sorted = [...voiceNotes].sort(
      (a, b) => a.startTick - b.startTick || a.id.localeCompare(b.id),
    );
    for (let i = 0; i < sorted.length; i += 1) {
      // Later notes can only overlap while they start before this one
      // ends, so each inner scan stops at the first non-overlap.
      for (let j = i + 1; j < sorted.length && sorted[j].startTick < sorted[i].endTick; j += 1) {
        conflicts.push({
          voiceId,
          noteIds: [sorted[i].id, sorted[j].id],
          startTick: sorted[j].startTick,
          endTick: Math.min(sorted[i].endTick, sorted[j].endTick),
        });
      }
    }
  }

  return conflicts.sort((a, b) => a.startTick - b.startTick || a.voiceId.localeCompare(b.voiceId));
}

/** Every note id involved in at least one conflict, for the canvas cue. */
export function conflictNoteIds(conflicts: readonly VoiceConflict[]): Set<string> {
  const ids = new Set<string>();
  for (const conflict of conflicts) {
    ids.add(conflict.noteIds[0]);
    ids.add(conflict.noteIds[1]);
  }
  return ids;
}

/**
 * The next conflict strictly after (or before, `direction: -1`) the
 * given tick, wrapping around at either end — same continuous-loop
 * stepping contract as `findNextFlaggedNoteId`. `currentTick: null`
 * (nothing selected yet) starts from the beginning/end.
 */
export function findNextConflict(
  conflicts: readonly VoiceConflict[],
  currentTick: number | null,
  direction: 1 | -1,
): VoiceConflict | null {
  if (conflicts.length === 0) {
    return null;
  }
  if (currentTick === null) {
    return direction === 1 ? conflicts[0] : conflicts[conflicts.length - 1];
  }

  if (direction === 1) {
    return conflicts.find((conflict) => conflict.startTick > currentTick) ?? conflicts[0];
  }
  return (
    [...conflicts].reverse().find((conflict) => conflict.startTick < currentTick) ??
    conflicts[conflicts.length - 1]
  );
}
