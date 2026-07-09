import type { MidiNote } from "../../domain/midi/midiProject";

/**
 * Musical (tick/pitch-space) smart-selection helpers behind the
 * double-click chord gesture, the right-click context menu, and the magic
 * wand paint tool. Pure functions over note lists — no canvas or viewport
 * involved — kept separate from `PianoRoll.tsx` for the same
 * unit-testability reason as `selection.ts`/`paintBrush.ts`.
 */

/** How aggressive the wand's phrase flood-fill is, in semitones. */
export const MIN_WAND_REACH = 1;
export const MAX_WAND_REACH = 12;
export const DEFAULT_WAND_REACH = 5;

export function clampWandReach(reach: number): number {
  return Math.min(MAX_WAND_REACH, Math.max(MIN_WAND_REACH, Math.round(reach)));
}

/**
 * Slack allowed between two notes' boundaries before they stop counting
 * as "the same chord": a 32nd note. Quantized files align exactly; a
 * human-recorded take needs a little give.
 */
export function chordToleranceTicks(ppq: number): number {
  return Math.max(1, Math.round(ppq / 8));
}

/**
 * The vertically stacked chord around `anchor`: every note whose start
 * AND end land within `toleranceTicks` of the anchor's. Always includes
 * the anchor itself.
 */
export function selectChord(
  anchor: MidiNote,
  notes: readonly MidiNote[],
  toleranceTicks: number,
): MidiNote[] {
  return notes.filter(
    (note) =>
      Math.abs(note.startTick - anchor.startTick) <= toleranceTicks &&
      Math.abs(note.endTick - anchor.endTick) <= toleranceTicks,
  );
}

function sweepLine(notes: readonly MidiNote[], keep: "highest" | "lowest"): MidiNote[] {
  if (notes.length === 0) {
    return [];
  }

  const boundaries = [...new Set(notes.flatMap((note) => [note.startTick, note.endTick]))].sort(
    (a, b) => a - b,
  );

  const lineIds = new Set<string>();
  for (let i = 0; i < boundaries.length - 1; i += 1) {
    // Sampling the segment midpoint sidesteps boundary ambiguity (a note
    // ending exactly where the next starts is sounding in neither's
    // neighbor segment).
    const t = (boundaries[i] + boundaries[i + 1]) / 2;
    const sounding = notes.filter((note) => note.startTick <= t && t < note.endTick);
    if (sounding.length === 0) {
      continue;
    }
    const extreme = sounding.reduce((best, note) => {
      if (keep === "highest") {
        return note.pitch > best.pitch ? note : best;
      }
      return note.pitch < best.pitch ? note : best;
    });
    // Unison ties all count as the line — dropping one arbitrarily would
    // leave a same-pitch note stranded for no audible reason.
    for (const note of sounding) {
      if (note.pitch === extreme.pitch) {
        lineIds.add(note.id);
      }
    }
  }

  return notes.filter((note) => lineIds.has(note.id));
}

/**
 * The melodic skyline of `notes`: every note that is the highest-pitched
 * sounding note at some moment during its span. In a chiptune arrangement
 * this is usually the lead line.
 */
export function selectTopLine(notes: readonly MidiNote[]): MidiNote[] {
  return sweepLine(notes, "highest");
}

/** Mirror of `selectTopLine` for the lowest sounding pitch — the bass line. */
export function selectBottomLine(notes: readonly MidiNote[]): MidiNote[] {
  return sweepLine(notes, "lowest");
}

export interface PhraseOptions {
  /** Largest silence between two notes that still connects them, in ticks. */
  maxGapTicks: number;
  /** Largest pitch jump between two connected notes, in semitones. */
  maxPitchJumpSemitones: number;
}

function areConnected(a: MidiNote, b: MidiNote, options: PhraseOptions): boolean {
  if (Math.abs(a.pitch - b.pitch) > options.maxPitchJumpSemitones) {
    return false;
  }
  // Time-adjacent: overlapping counts as gap zero, otherwise measure the
  // silence between the earlier end and the later start.
  const gap = Math.max(a.startTick, b.startTick) - Math.min(a.endTick, b.endTick);
  return gap <= options.maxGapTicks;
}

/**
 * The magic wand's flood fill: the connected melodic run containing
 * `anchor`, walking in both time directions across notes that are
 * adjacent in time (within `maxGapTicks`) and close in pitch (within
 * `maxPitchJumpSemitones`). Same continuity idea the assignment heuristic
 * scores, exposed as a one-click gesture.
 */
export function selectPhrase(
  anchor: MidiNote,
  notes: readonly MidiNote[],
  options: PhraseOptions,
): MidiNote[] {
  const inPhrase = new Set([anchor.id]);
  const queue = [anchor];

  while (queue.length > 0) {
    const current = queue.pop() as MidiNote;
    for (const candidate of notes) {
      if (!inPhrase.has(candidate.id) && areConnected(current, candidate, options)) {
        inPhrase.add(candidate.id);
        queue.push(candidate);
      }
    }
  }

  return notes.filter((note) => inPhrase.has(note.id));
}
