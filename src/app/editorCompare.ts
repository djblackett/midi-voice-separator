import type { AssignmentProvenance } from "../domain/midi/assignmentProvenance";
import type { MidiProject, MidiVoice } from "../domain/midi/midiProject";
import { matchVoices, toDiffSide, type VoiceMatching } from "../domain/midi/assignmentDiff";
import type { VoiceOverrides } from "../domain/midi/voiceAssignments";
import { materializeEditorProject } from "../domain/midi/editorMaterialization";
import type { BranchId } from "./editor/editorBranch";
import type { EditorSnapshot } from "./editorHistory";
import type { NamedSnapshot } from "./editorSnapshots";

export type CompareViewing = "A" | "B" | "diff";

/**
 * Reference-only comparison state (M4). It names the snapshot side B is drawn
 * from, which side edits and inspectors bind to (`activeSide`), and which side
 * the single canvas is showing (`viewing`). It never stores materialized
 * projects, diffs, matches, or scores. Until B can be forked into a live
 * branch (slice D2), `activeSide` is always "A" and B is a snapshot reference.
 */
export interface ComparisonWorkspace {
  targetSnapshotId: string;
  activeSide: BranchId;
  viewing: CompareViewing;
}

export interface CurrentEditorCompareState extends EditorSnapshot {
  assignmentProvenance: AssignmentProvenance;
}

export interface ComparePreview {
  project: MidiProject | null;
  matching: VoiceMatching | null;
}

/**
 * Editing is disabled whenever the canvas shows a side other than the one
 * being edited -- the "diff" view included, since it is never an editable
 * side. With `activeSide` pinned to "A" this reproduces the prior "B and diff
 * are read-only" rule while expressing it in the terms slice D3 needs.
 */
export function isEditingDisabledForComparison(workspace: ComparisonWorkspace | null): boolean {
  return workspace !== null && workspace.viewing !== workspace.activeSide;
}

export function createComparisonWorkspace(targetSnapshotId: string): ComparisonWorkspace {
  return { targetSnapshotId, activeSide: "A", viewing: "A" };
}

export function updateComparisonViewing(
  workspace: ComparisonWorkspace | null,
  viewing: CompareViewing,
): ComparisonWorkspace | null {
  return workspace ? { ...workspace, viewing } : null;
}

export function materializeSnapshotProject(snapshot: NamedSnapshot | null): MidiProject | null {
  return snapshot ? materializeEditorProject(snapshot.state) : null;
}

export function buildComparePreview(
  workspace: ComparisonWorkspace | null,
  snapshots: readonly NamedSnapshot[],
  current: CurrentEditorCompareState,
): ComparePreview {
  if (!workspace || workspace.viewing === "A") {
    return { project: current.project, matching: null };
  }

  const targetSnapshot = snapshots.find((snapshot) => snapshot.id === workspace.targetSnapshotId);
  if (!targetSnapshot) {
    return { project: current.project, matching: null };
  }

  const targetProject = materializeSnapshotProject(targetSnapshot);
  const currentSide = toDiffSide(current, current.assignmentProvenance);
  const targetSide = toDiffSide(targetSnapshot.state, targetSnapshot.assignmentProvenance);
  const matching = currentSide && targetSide ? matchVoices(currentSide, targetSide) : null;

  return { project: workspace.viewing === "B" ? targetProject : current.project, matching };
}

export function mapSoloVoiceForPreview(
  soloVoiceId: string | null,
  matching: VoiceMatching | null,
): string | null {
  if (!soloVoiceId || !matching) {
    return null;
  }
  return (
    matching.matched.find((match) => match.beforeVoiceId === soloVoiceId)?.afterVoiceId ?? null
  );
}

export function describeVoiceMatch(
  voice: MidiVoice,
  matching: VoiceMatching | null,
): string | null {
  if (!matching) {
    return null;
  }
  const match = matching.matched.find((item) => item.afterVoiceId === voice.id);
  return match ? `Matches ${match.beforeVoiceId}` : "New in preview";
}

/**
 * Compatibility adapter for legacy snapshot consumers. The active editor
 * itself now owns one EditorDocument/branch; this helper only clones its
 * correction layer into the older snapshot shape.
 */
export function editorSnapshotFromCurrent(current: {
  project: MidiProject | null;
  voiceOverrides: VoiceOverrides;
  voiceOrder: readonly string[];
  voiceLabels: Readonly<Record<string, string>>;
  rangeAssignedNoteIds: ReadonlySet<string>;
}): EditorSnapshot {
  return {
    project: current.project,
    voiceOverrides: current.voiceOverrides,
    voiceOrder: [...current.voiceOrder],
    voiceLabels: { ...current.voiceLabels },
    rangeAssignedNoteIds: new Set(current.rangeAssignedNoteIds),
  };
}
