import type { AssignmentMode } from "../lib/tauri/commands";
import {
  STRATEGY_LABELS,
  type MidiProject,
  type SeparationStrategy,
} from "../domain/midi/midiProject";
import type { EditorSnapshot } from "./editorHistory";

export type SnapshotSource = "import" | "manual" | "before-rerun" | "after-rerun" | "restore";

export interface RerunSettings {
  strategy: SeparationStrategy;
  assignmentMode: AssignmentMode;
  maxVoiceCount: number | null;
}

/**
 * A user-facing, named point-in-time capture of the editor. Wraps the
 * existing `EditorSnapshot` (used by undo/redo) rather than duplicating its
 * fields, so anything added to `EditorSnapshot` later is captured here too.
 * Always carries the full `project`, not just the override/order/label
 * state, so restoring across a "Re-run separation" boundary (which replaces
 * `project` wholesale) never produces a half-reverted state.
 */
export interface NamedSnapshot {
  id: string;
  name: string;
  createdAt: number;
  source: SnapshotSource;
  rerunSettings: RerunSettings;
  state: EditorSnapshot;
}

let nextSnapshotSequence = 1;

function generateSnapshotId(): string {
  const id = `snapshot-${nextSnapshotSequence}`;
  nextSnapshotSequence += 1;
  return id;
}

/** Exposed for tests that need deterministic ids across runs. */
export function resetSnapshotIdSequence(): void {
  nextSnapshotSequence = 1;
}

const SOURCE_DEFAULT_NAMES: Record<SnapshotSource, string> = {
  import: "Import",
  manual: "Manual snapshot",
  "before-rerun": "Before rerun",
  "after-rerun": "After rerun",
  restore: "Restore point",
};

export function formatSnapshotTimestamp(createdAt: number): string {
  return new Date(createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function defaultSnapshotName(source: SnapshotSource, createdAt: number): string {
  return `${SOURCE_DEFAULT_NAMES[source]} — ${formatSnapshotTimestamp(createdAt)}`;
}

/** Short, human-readable label for a snapshot's source, for list display. */
export function formatSnapshotSource(source: SnapshotSource): string {
  return SOURCE_DEFAULT_NAMES[source];
}

const ASSIGNMENT_MODE_SHORT_LABELS: Record<AssignmentMode, string> = {
  GREEDY: "Greedy",
  GLOBAL: "Global",
  CONTIG: "Contig",
};

/** One-line summary of the re-run settings a snapshot was produced under. */
export function formatRerunSettings(settings: RerunSettings): string {
  const voices =
    settings.maxVoiceCount === null ? "auto voices" : `max ${settings.maxVoiceCount} voices`;
  return `${STRATEGY_LABELS[settings.strategy]} · ${ASSIGNMENT_MODE_SHORT_LABELS[settings.assignmentMode]} · ${voices}`;
}

/** One-line "source · time · re-run settings" summary for a snapshot list row. */
export function formatSnapshotSummary(snapshot: NamedSnapshot): string {
  return `${formatSnapshotSource(snapshot.source)} · ${formatSnapshotTimestamp(snapshot.createdAt)} · ${formatRerunSettings(snapshot.rerunSettings)}`;
}

export function createNamedSnapshot(
  state: EditorSnapshot,
  rerunSettings: RerunSettings,
  source: SnapshotSource,
  name?: string,
  createdAt: number = Date.now(),
): NamedSnapshot {
  return {
    id: generateSnapshotId(),
    name: name ?? defaultSnapshotName(source, createdAt),
    createdAt,
    source,
    rerunSettings,
    state,
  };
}

/** Returns the wrapped `EditorSnapshot` to apply via the same setters undo/redo uses. */
export function restoreEditorState(snapshot: NamedSnapshot): EditorSnapshot {
  return snapshot.state;
}

const AUTO_SNAPSHOT_SOURCE_CAP = 5;

/**
 * Appends a new snapshot, then prunes older auto-generated `before-rerun`/
 * `after-rerun` entries beyond `AUTO_SNAPSHOT_SOURCE_CAP` each (oldest
 * dropped first) so a session with many re-runs doesn't grow the list
 * unbounded. `import`/`manual`/`restore` snapshots are never pruned — only
 * the two sources a single "Re-run separation" click can spam.
 */
export function appendSnapshot(
  snapshots: readonly NamedSnapshot[],
  snapshot: NamedSnapshot,
): NamedSnapshot[] {
  const next = [...snapshots, snapshot];
  const beforeRerunIds = next
    .filter((entry) => entry.source === "before-rerun")
    .map((entry) => entry.id);
  const afterRerunIds = next
    .filter((entry) => entry.source === "after-rerun")
    .map((entry) => entry.id);
  const droppedIds = new Set([
    ...beforeRerunIds.slice(0, Math.max(0, beforeRerunIds.length - AUTO_SNAPSHOT_SOURCE_CAP)),
    ...afterRerunIds.slice(0, Math.max(0, afterRerunIds.length - AUTO_SNAPSHOT_SOURCE_CAP)),
  ]);
  return droppedIds.size === 0 ? next : next.filter((entry) => !droppedIds.has(entry.id));
}

/**
 * The materialized (displayed) voice assignment for every note: the override
 * if one exists, otherwise the note's own `voiceId`. This is the composition
 * `displayedProject` already uses (`applyVoiceOverrides`) and must be the
 * single basis for any assignment comparison — never the raw project or the
 * override map alone, since either one in isolation omits information the
 * other supplies.
 */
export function materializeAssignments(
  project: MidiProject,
  voiceOverrides: Record<string, string>,
): ReadonlyMap<string, string> {
  const assignments = new Map<string, string>();
  for (const note of project.notes) {
    assignments.set(note.id, voiceOverrides[note.id] ?? note.voiceId);
  }
  return assignments;
}
