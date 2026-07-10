import type { MidiNote, MidiProject, MidiVoice, SeparationStrategy } from "./midiProject";
import { LOW_CONFIDENCE_THRESHOLD } from "./midiProject";
import type { VoiceOverrides } from "./voiceAssignments";
import { materializeAssignments } from "./voiceAssignments";
import { PERCUSSION_VOICE_ID } from "./voiceManagement";
import { materializeEditorProject } from "./editorMaterialization";

/**
 * Structurally matches `RerunSettings` in `src/app/editorSnapshots.ts`
 * without importing it, so this domain module stays independent of the
 * app layer (`AssignmentMode`'s three values mirror the Rust
 * `AssignmentMode` enum the same way `lib/tauri/commands.ts` already does).
 */
export interface DiffRerunSettings {
  strategy: SeparationStrategy;
  assignmentMode: "GREEDY" | "GLOBAL" | "CONTIG";
  maxVoiceCount: number | null;
}

/**
 * One side of an assignment comparison: the materialized (displayed)
 * project state plus enough context to gate confidence comparisons (C5)
 * and identify locked notes (C4).
 */
export interface DiffSide {
  notes: readonly MidiNote[];
  voices: readonly MidiVoice[];
  assignments: ReadonlyMap<string, string>;
  lockedNoteIds: ReadonlySet<string>;
  rerunSettings: DiffRerunSettings;
}

export interface DiffEditorState {
  project: MidiProject | null;
  voiceOverrides: VoiceOverrides;
  voiceOrder: readonly string[];
  voiceLabels: Readonly<Record<string, string>>;
}

/**
 * Builds a `DiffSide` the same way `App.tsx` builds `displayedProject`:
 * overrides applied to notes, voices rebuilt from `voiceOrder`/`voiceLabels`
 * against the overridden notes (so voices created only by correction, not
 * present in the raw imported/re-run project, are included). Returns `null`
 * when there is no project to diff.
 */
export function toDiffSide(
  editorState: DiffEditorState,
  rerunSettings: DiffRerunSettings,
): DiffSide | null {
  const { project, voiceOverrides } = editorState;
  if (!project) {
    return null;
  }
  const materialized = materializeEditorProject(editorState);
  if (!materialized) {
    return null;
  }

  return {
    notes: materialized.notes,
    voices: materialized.voices,
    assignments: materializeAssignments(project, voiceOverrides),
    lockedNoteIds: new Set(Object.keys(voiceOverrides)),
    rerunSettings,
  };
}

export interface VoiceMatch {
  beforeVoiceId: string;
  afterVoiceId: string;
}

export interface VoiceMatching {
  matched: readonly VoiceMatch[];
  removedVoiceIds: readonly string[];
  addedVoiceIds: readonly string[];
}

/**
 * Pairs `before`/`after` voices by maximum shared-note overlap so voice ids
 * (which are reallocated fresh on every full re-run, preserving only locked
 * ids) never get mistaken for stable identity -- see C3 in
 * `PLAN.local.md`. The percussion voice, if present on both sides, is
 * pre-matched to itself by its fixed id and never enters the general
 * overlap pool; if present on only one side it is excluded entirely (never
 * appears in `matched`/`addedVoiceIds`/`removedVoiceIds`) since its
 * presence is reported separately via `AssignmentDiff.percussionDelta`
 * (C7).
 */
export function matchVoices(before: DiffSide, after: DiffSide): VoiceMatching {
  const beforeVoiceIds = before.voices
    .map((voice) => voice.id)
    .filter((id) => id !== PERCUSSION_VOICE_ID);
  const afterVoiceIds = after.voices
    .map((voice) => voice.id)
    .filter((id) => id !== PERCUSSION_VOICE_ID);

  const overlap = new Map<string, Map<string, number>>();
  for (const [noteId, beforeVoiceId] of before.assignments) {
    if (beforeVoiceId === PERCUSSION_VOICE_ID) {
      continue;
    }
    const afterVoiceId = after.assignments.get(noteId);
    if (afterVoiceId === undefined || afterVoiceId === PERCUSSION_VOICE_ID) {
      continue;
    }
    const row = overlap.get(beforeVoiceId) ?? new Map<string, number>();
    row.set(afterVoiceId, (row.get(afterVoiceId) ?? 0) + 1);
    overlap.set(beforeVoiceId, row);
  }

  const remainingBefore = new Set(beforeVoiceIds);
  const remainingAfter = new Set(afterVoiceIds);
  const matched: VoiceMatch[] = [];

  const percussionInBefore = before.voices.some((voice) => voice.id === PERCUSSION_VOICE_ID);
  const percussionInAfter = after.voices.some((voice) => voice.id === PERCUSSION_VOICE_ID);
  if (percussionInBefore && percussionInAfter) {
    matched.push({ beforeVoiceId: PERCUSSION_VOICE_ID, afterVoiceId: PERCUSSION_VOICE_ID });
  }

  // Greedy max-overlap matching: repeatedly commit the single best
  // remaining pair until no positive-overlap pair is left. Sufficient at
  // chiptune-file voice counts (single digits to low tens).
  for (;;) {
    let bestBeforeId: string | null = null;
    let bestAfterId: string | null = null;
    let bestCount = 0;
    for (const beforeId of remainingBefore) {
      const row = overlap.get(beforeId);
      if (!row) {
        continue;
      }
      for (const afterId of remainingAfter) {
        const count = row.get(afterId) ?? 0;
        if (count > bestCount) {
          bestCount = count;
          bestBeforeId = beforeId;
          bestAfterId = afterId;
        }
      }
    }
    if (bestBeforeId === null || bestAfterId === null) {
      break;
    }
    matched.push({ beforeVoiceId: bestBeforeId, afterVoiceId: bestAfterId });
    remainingBefore.delete(bestBeforeId);
    remainingAfter.delete(bestAfterId);
  }

  return {
    matched,
    removedVoiceIds: [...remainingBefore],
    addedVoiceIds: [...remainingAfter],
  };
}

export interface VoiceLabelChange {
  beforeVoiceId: string;
  afterVoiceId: string;
  beforeLabel: string;
  afterLabel: string;
}

export interface PercussionDelta {
  beforeCount: number;
  afterCount: number;
}

export interface ConfidenceDelta {
  improvedNoteIds: readonly string[];
  worsenedNoteIds: readonly string[];
}

export interface AssignmentDiff {
  comparable: true;
  /** Notes that moved between two *matched* voices (a genuine reassignment). */
  changedNoteIds: readonly string[];
  /** Notes present before but not after (e.g. deleted/rebuilt on a re-run). */
  onlyInBeforeNoteIds: readonly string[];
  /** Notes present after but not before. */
  onlyInAfterNoteIds: readonly string[];
  addedVoiceIds: readonly string[];
  removedVoiceIds: readonly string[];
  changedVoiceLabels: readonly VoiceLabelChange[];
  /**
   * Of the notes locked (had an override) on both sides, how many are still
   * assigned to the same (matched) voice -- i.e. the correction survived.
   */
  locksPreservedCount: number;
  /** `null` when the percussion voice exists on neither side. */
  percussionDelta: PercussionDelta | null;
  /** False when `before`/`after` used a different strategy or search mode (C5). */
  confidenceComparable: boolean;
  confidence: ConfidenceDelta | null;
}

export interface DiffIncomparable {
  comparable: false;
  reason: string;
}

export type DiffResult = AssignmentDiff | DiffIncomparable;

function countAssignedTo(assignments: ReadonlyMap<string, string>, voiceId: string): number {
  let count = 0;
  for (const assignedVoiceId of assignments.values()) {
    if (assignedVoiceId === voiceId) {
      count += 1;
    }
  }
  return count;
}

/**
 * Computes the diff given an already-built `VoiceMatching`. Operates on
 * materialized (post-override) assignments only, per C6 -- never the raw
 * project or the override map alone.
 */
export function compareAssignments(
  before: DiffSide,
  after: DiffSide,
  matching: VoiceMatching,
): AssignmentDiff {
  const expectedAfterVoiceIdByBefore = new Map(
    matching.matched.map((match) => [match.beforeVoiceId, match.afterVoiceId]),
  );

  const changedNoteIds: string[] = [];
  const onlyInBeforeNoteIds: string[] = [];
  for (const [noteId, beforeVoiceId] of before.assignments) {
    const afterVoiceId = after.assignments.get(noteId);
    if (afterVoiceId === undefined) {
      onlyInBeforeNoteIds.push(noteId);
      continue;
    }
    if (beforeVoiceId === PERCUSSION_VOICE_ID || afterVoiceId === PERCUSSION_VOICE_ID) {
      // Percussion routing is reported via percussionDelta, not as a
      // per-note reassignment.
      continue;
    }
    if (expectedAfterVoiceIdByBefore.get(beforeVoiceId) !== afterVoiceId) {
      changedNoteIds.push(noteId);
    }
  }

  const onlyInAfterNoteIds: string[] = [];
  for (const noteId of after.assignments.keys()) {
    if (!before.assignments.has(noteId)) {
      onlyInAfterNoteIds.push(noteId);
    }
  }

  const beforeLabelById = new Map(before.voices.map((voice) => [voice.id, voice.label]));
  const afterLabelById = new Map(after.voices.map((voice) => [voice.id, voice.label]));
  const changedVoiceLabels: VoiceLabelChange[] = [];
  for (const match of matching.matched) {
    const beforeLabel = beforeLabelById.get(match.beforeVoiceId);
    const afterLabel = afterLabelById.get(match.afterVoiceId);
    if (beforeLabel !== undefined && afterLabel !== undefined && beforeLabel !== afterLabel) {
      changedVoiceLabels.push({
        beforeVoiceId: match.beforeVoiceId,
        afterVoiceId: match.afterVoiceId,
        beforeLabel,
        afterLabel,
      });
    }
  }

  let locksPreservedCount = 0;
  for (const noteId of before.lockedNoteIds) {
    if (!after.lockedNoteIds.has(noteId)) {
      continue;
    }
    const beforeVoiceId = before.assignments.get(noteId);
    const afterVoiceId = after.assignments.get(noteId);
    if (beforeVoiceId === undefined || afterVoiceId === undefined) {
      continue;
    }
    const expectedAfterVoiceId =
      beforeVoiceId === PERCUSSION_VOICE_ID
        ? PERCUSSION_VOICE_ID
        : expectedAfterVoiceIdByBefore.get(beforeVoiceId);
    if (expectedAfterVoiceId === afterVoiceId) {
      locksPreservedCount += 1;
    }
  }

  const percussionInBefore = before.voices.some((voice) => voice.id === PERCUSSION_VOICE_ID);
  const percussionInAfter = after.voices.some((voice) => voice.id === PERCUSSION_VOICE_ID);
  const percussionDelta =
    percussionInBefore || percussionInAfter
      ? {
          beforeCount: countAssignedTo(before.assignments, PERCUSSION_VOICE_ID),
          afterCount: countAssignedTo(after.assignments, PERCUSSION_VOICE_ID),
        }
      : null;

  const confidenceComparable =
    before.rerunSettings.strategy === after.rerunSettings.strategy &&
    before.rerunSettings.assignmentMode === after.rerunSettings.assignmentMode;

  let confidence: ConfidenceDelta | null = null;
  if (confidenceComparable) {
    const beforeConfidenceById = new Map(
      before.notes.map((note) => [note.id, note.assignmentConfidence]),
    );
    const afterConfidenceById = new Map(
      after.notes.map((note) => [note.id, note.assignmentConfidence]),
    );
    const improvedNoteIds: string[] = [];
    const worsenedNoteIds: string[] = [];
    for (const noteId of before.assignments.keys()) {
      if (!after.assignments.has(noteId)) {
        continue;
      }
      const beforeConfidence = beforeConfidenceById.get(noteId);
      const afterConfidence = afterConfidenceById.get(noteId);
      if (beforeConfidence === undefined || afterConfidence === undefined) {
        continue;
      }
      const wasLow = beforeConfidence < LOW_CONFIDENCE_THRESHOLD;
      const isLow = afterConfidence < LOW_CONFIDENCE_THRESHOLD;
      if (wasLow && !isLow) {
        improvedNoteIds.push(noteId);
      } else if (!wasLow && isLow) {
        worsenedNoteIds.push(noteId);
      }
    }
    confidence = { improvedNoteIds, worsenedNoteIds };
  }

  return {
    comparable: true,
    changedNoteIds,
    onlyInBeforeNoteIds,
    onlyInAfterNoteIds,
    addedVoiceIds: matching.addedVoiceIds,
    removedVoiceIds: matching.removedVoiceIds,
    changedVoiceLabels,
    locksPreservedCount,
    percussionDelta,
    confidenceComparable,
    confidence,
  };
}

/** Below this shared-note-id ratio, two sides are treated as unrelated imports (C2). */
const MIN_SHARED_NOTE_RATIO = 0.5;

/**
 * Top-level entry point: guards against comparing two (near-)disjoint note-id
 * sets -- which happens whenever one side crossed an export/reimport
 * boundary, since note ids embed the source track index and are
 * regenerated on reimport (C2) -- then matches voices and diffs.
 */
export function diffAssignments(before: DiffSide, after: DiffSide): DiffResult {
  const beforeIds = before.assignments;
  const afterIds = after.assignments;
  let sharedCount = 0;
  for (const noteId of beforeIds.keys()) {
    if (afterIds.has(noteId)) {
      sharedCount += 1;
    }
  }
  const totalUnique = new Set([...beforeIds.keys(), ...afterIds.keys()]).size;

  if (totalUnique === 0 || sharedCount / totalUnique < MIN_SHARED_NOTE_RATIO) {
    return {
      comparable: false,
      reason:
        "These two states share too few notes to compare, and are likely from different imports -- note ids don't survive export/reimport.",
    };
  }

  const matching = matchVoices(before, after);
  return compareAssignments(before, after, matching);
}

/** Notes present on only one side -- neither reassigned nor unchanged, since there's nothing on the other side to compare against. */
export function formatOnlyInOneSideSummary(diff: AssignmentDiff): string | null {
  const { onlyInBeforeNoteIds, onlyInAfterNoteIds } = diff;
  if (onlyInBeforeNoteIds.length === 0 && onlyInAfterNoteIds.length === 0) {
    return null;
  }

  const parts: string[] = [];
  if (onlyInBeforeNoteIds.length > 0) {
    parts.push(`${onlyInBeforeNoteIds.length} only in the earlier state`);
  }
  if (onlyInAfterNoteIds.length > 0) {
    parts.push(`${onlyInAfterNoteIds.length} only in the current state`);
  }
  return `${parts.join(", ")}.`;
}

export function formatPercussionDelta(delta: PercussionDelta): string {
  return delta.beforeCount === delta.afterCount
    ? `${delta.afterCount} percussion notes (unchanged).`
    : `Percussion notes: ${delta.beforeCount} → ${delta.afterCount}.`;
}

/** Confidence deltas are only meaningful within one strategy/search-mode pair (C5). */
export function formatConfidenceDelta(diff: AssignmentDiff): string {
  if (!diff.confidenceComparable || !diff.confidence) {
    return "Not comparable — the two sides used a different strategy or search mode.";
  }

  const { improvedNoteIds, worsenedNoteIds } = diff.confidence;
  if (improvedNoteIds.length === 0 && worsenedNoteIds.length === 0) {
    return "No confidence change.";
  }

  const parts: string[] = [];
  if (improvedNoteIds.length > 0) {
    parts.push(`${improvedNoteIds.length} improved`);
  }
  if (worsenedNoteIds.length > 0) {
    parts.push(`${worsenedNoteIds.length} worsened`);
  }
  return `${parts.join(", ")}.`;
}
