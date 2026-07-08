import type { AssignmentMode } from "../lib/tauri/commands";
import type { MidiProject, SeparationStrategy } from "../domain/midi/midiProject";
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

export function defaultSnapshotName(source: SnapshotSource, createdAt: number): string {
  const time = new Date(createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${SOURCE_DEFAULT_NAMES[source]} — ${time}`;
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
