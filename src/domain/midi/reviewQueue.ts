import type { MidiNote } from "./midiProject";
import { LOW_CONFIDENCE_THRESHOLD } from "./midiProject";

export function buildFlaggedNoteQueue(notes: readonly MidiNote[]): MidiNote[] {
  return notes
    .filter((note) => note.assignmentConfidence < LOW_CONFIDENCE_THRESHOLD)
    .sort((left, right) => left.startTick - right.startTick);
}

/**
 * Steps through an already-time-sorted flagged-note queue relative to the
 * current selection's start tick, wrapping around at either end so review
 * mode behaves like a continuous loop rather than stopping at the edges.
 */
export function findNextFlaggedNoteId(
  flaggedNotes: readonly MidiNote[],
  currentStartTick: number | null,
  direction: 1 | -1,
): string | null {
  if (flaggedNotes.length === 0) {
    return null;
  }

  if (currentStartTick === null) {
    return direction === 1 ? flaggedNotes[0].id : flaggedNotes[flaggedNotes.length - 1].id;
  }

  if (direction === 1) {
    const next = flaggedNotes.find((note) => note.startTick > currentStartTick);
    return (next ?? flaggedNotes[0]).id;
  }

  const previous = [...flaggedNotes].reverse().find((note) => note.startTick < currentStartTick);
  return (previous ?? flaggedNotes[flaggedNotes.length - 1]).id;
}
