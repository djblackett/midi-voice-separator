import type { MidiNote } from "./midiProject";
import { LOW_CONFIDENCE_THRESHOLD } from "./midiProject";
import type { VoiceOverrides } from "./voiceAssignments";

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
export interface ReviewProgress {
  flaggedCount: number;
  reviewedCount: number;
  remainingCount: number;
}

export function buildReviewProgress(
  flaggedNotes: readonly MidiNote[],
  voiceOverrides: VoiceOverrides,
  skippedNoteIds: ReadonlySet<string>,
): ReviewProgress {
  let reviewedCount = 0;
  for (const note of flaggedNotes) {
    if (voiceOverrides[note.id] !== undefined || skippedNoteIds.has(note.id)) {
      reviewedCount += 1;
    }
  }

  return {
    flaggedCount: flaggedNotes.length,
    reviewedCount,
    remainingCount: Math.max(0, flaggedNotes.length - reviewedCount),
  };
}

export function findCurrentFlaggedNote(
  flaggedNotes: readonly MidiNote[],
  selectedNoteIds: ReadonlySet<string>,
): MidiNote | null {
  if (selectedNoteIds.size !== 1) {
    return null;
  }
  const [selectedNoteId] = selectedNoteIds;
  return flaggedNotes.find((note) => note.id === selectedNoteId) ?? null;
}

export function applyReviewDecision(
  voiceOverrides: VoiceOverrides,
  rangeAssignedNoteIds: ReadonlySet<string>,
  noteId: string,
  voiceId: string,
): { voiceOverrides: VoiceOverrides; rangeAssignedNoteIds: ReadonlySet<string> } {
  const nextRangeAssignedNoteIds = new Set(rangeAssignedNoteIds);
  nextRangeAssignedNoteIds.delete(noteId);

  return {
    voiceOverrides: { ...voiceOverrides, [noteId]: voiceId },
    rangeAssignedNoteIds: nextRangeAssignedNoteIds,
  };
}
