import type { AssignmentProvenance } from "../domain/midi/assignmentProvenance";
import type { MidiProject, MidiVoice } from "../domain/midi/midiProject";
import { matchVoices, toDiffSide, type VoiceMatching } from "../domain/midi/assignmentDiff";
import type { VoiceOverrides } from "../domain/midi/voiceAssignments";
import { materializeEditorProject } from "../domain/midi/editorMaterialization";
import type { BranchId } from "./editor/editorBranch";
import type { DocumentId } from "./editor/editorDocument";
import type { EditorSnapshot } from "./editorHistory";
import type { NamedSnapshot } from "./editorSnapshots";
import type { ReferenceDocumentId } from "./referenceDocument";

export type CompareViewing = "A" | "B" | "diff";
export type ReferenceCompareViewing = "current" | "reference" | "diff";

/** Single canvas (the A/B/Diff toggle) or two panes side by side (M13). */
export type ComparisonLayout = "single" | "split";

/**
 * Reference-only comparison state (M4). It names the snapshot side B was forked
 * from, which side the single canvas is showing (`viewing`), and the `layout`
 * (single canvas vs. split panes). It never stores materialized projects,
 * diffs, matches, or scores. The editable `activeSide` is owned by the branch
 * hook, not duplicated here.
 */
export interface EditableSnapshotWorkspace {
  readonly kind: "editableSnapshot";
  readonly targetSnapshotId: string;
  readonly viewing: CompareViewing;
  readonly layout: ComparisonLayout;
}

export interface ExternalReferenceTarget {
  readonly branchId: BranchId;
  readonly documentId: DocumentId;
  readonly revision: number;
}

export interface ExternalReferenceWorkspace {
  readonly kind: "externalReference";
  readonly referenceDocumentId: ReferenceDocumentId;
  readonly target: ExternalReferenceTarget;
  readonly viewing: ReferenceCompareViewing;
  readonly layout: ComparisonLayout;
}

export type ComparisonWorkspace = EditableSnapshotWorkspace | ExternalReferenceWorkspace;

export interface CurrentEditorCompareState extends EditorSnapshot {
  assignmentProvenance: AssignmentProvenance;
}

export interface ComparePreview {
  project: MidiProject | null;
  matching: VoiceMatching | null;
}

/**
 * In single layout, editing is disabled whenever the canvas shows a side other
 * than the active one -- including the read-only diff view. Split renders both
 * sides and the active pane is always editable, so the single-view `viewing`
 * field must not make active B read-only.
 */
export function isEditingDisabledForComparison(
  workspace: ComparisonWorkspace | null,
  activeSide: BranchId,
): boolean {
  if (!workspace) {
    return false;
  }
  if (workspace.kind === "externalReference") {
    if (activeSide !== workspace.target.branchId) {
      return true;
    }
    return workspace.layout === "single" && workspace.viewing !== "current";
  }
  return workspace.layout === "single" && workspace.viewing !== activeSide;
}

export function createComparisonWorkspace(targetSnapshotId: string): EditableSnapshotWorkspace {
  return { kind: "editableSnapshot", targetSnapshotId, viewing: "A", layout: "single" };
}

export function createExternalReferenceWorkspace(
  referenceDocumentId: ReferenceDocumentId,
  target: ExternalReferenceTarget,
): ExternalReferenceWorkspace {
  return {
    kind: "externalReference",
    referenceDocumentId,
    target,
    viewing: "current",
    layout: "single",
  };
}

export function updateComparisonViewing(
  workspace: ComparisonWorkspace | null,
  viewing: CompareViewing | ReferenceCompareViewing,
): ComparisonWorkspace | null {
  if (!workspace) {
    return null;
  }
  if (workspace.kind === "editableSnapshot") {
    return viewing === "A" || viewing === "B" || viewing === "diff"
      ? { ...workspace, viewing }
      : workspace;
  }
  return viewing === "current" || viewing === "reference" || viewing === "diff"
    ? { ...workspace, viewing }
    : workspace;
}

export function materializeSnapshotProject(snapshot: NamedSnapshot | null): MidiProject | null {
  return snapshot ? materializeEditorProject(snapshot.state) : null;
}

export function buildComparePreview(
  workspace: ComparisonWorkspace | null,
  snapshots: readonly NamedSnapshot[],
  current: CurrentEditorCompareState,
): ComparePreview {
  if (!workspace || workspace.kind !== "editableSnapshot" || workspace.viewing === "A") {
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
