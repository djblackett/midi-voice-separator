import type { MidiProject } from "../domain/midi/midiProject";
import type { VoiceOverrides } from "../domain/midi/voiceAssignments";

export interface EditorSnapshot {
  project: MidiProject | null;
  voiceOverrides: VoiceOverrides;
  voiceOrder: string[];
  voiceLabels: Record<string, string>;
}

export interface EditorHistoryState {
  past: EditorSnapshot[];
  future: EditorSnapshot[];
}

export interface EditorHistoryStep {
  history: EditorHistoryState;
  snapshot: EditorSnapshot;
}

const MAX_HISTORY_DEPTH = 50;

export function createEditorHistory(): EditorHistoryState {
  return { past: [], future: [] };
}

/**
 * Records `snapshot` (the state immediately before a mutating action) onto
 * the undo stack and clears the redo stack, since a new action invalidates
 * whatever was previously undone. Caps depth at MAX_HISTORY_DEPTH — chiptune
 * files are small enough that full snapshots, not diffs, are cheap.
 *
 * `project` is part of the snapshot too (not just the override/order/label
 * state) so a "Re-run separation" call, which replaces `project` wholesale,
 * is undoable like every other correction.
 */
export function pushHistory(
  history: EditorHistoryState,
  snapshot: EditorSnapshot,
): EditorHistoryState {
  const past = [...history.past, snapshot].slice(-MAX_HISTORY_DEPTH);
  return { past, future: [] };
}

export function undoHistory(
  history: EditorHistoryState,
  current: EditorSnapshot,
): EditorHistoryStep | null {
  if (history.past.length === 0) {
    return null;
  }

  const snapshot = history.past[history.past.length - 1];
  const past = history.past.slice(0, -1);
  const future = [current, ...history.future];
  return { history: { past, future }, snapshot };
}

export function redoHistory(
  history: EditorHistoryState,
  current: EditorSnapshot,
): EditorHistoryStep | null {
  if (history.future.length === 0) {
    return null;
  }

  const snapshot = history.future[0];
  const future = history.future.slice(1);
  const past = [...history.past, current];
  return { history: { past, future }, snapshot };
}
