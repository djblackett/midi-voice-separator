import type { AssignmentProvenance } from "../domain/midi/assignmentProvenance";
import type { MidiProject, MidiVoice } from "../domain/midi/midiProject";
import { matchVoices, toDiffSide, type VoiceMatching } from "../domain/midi/assignmentDiff";
import type { VoiceOverrides } from "../domain/midi/voiceAssignments";
import { materializeEditorProject } from "../domain/midi/editorMaterialization";
import type { EditorSnapshot } from "./editorHistory";
import type { NamedSnapshot } from "./editorSnapshots";

export type CompareViewing = "A" | "B" | "diff";

export interface CompareState {
  baselineSnapshotId: string;
  targetSnapshotId: string;
  viewing: CompareViewing;
}

export interface CurrentEditorCompareState extends EditorSnapshot {
  assignmentProvenance: AssignmentProvenance;
}

export interface ComparePreview {
  project: MidiProject | null;
  matching: VoiceMatching | null;
}

export function isReadOnlyCompareViewing(viewing: CompareViewing): boolean {
  return viewing === "B" || viewing === "diff";
}

export function isEditingDisabledForCompare(compareState: CompareState | null): boolean {
  return compareState !== null && isReadOnlyCompareViewing(compareState.viewing);
}

export function createCompareState(
  baselineSnapshotId: string,
  targetSnapshotId: string,
): CompareState {
  return { baselineSnapshotId, targetSnapshotId, viewing: "A" };
}

export function updateCompareViewing(
  compareState: CompareState | null,
  viewing: CompareViewing,
): CompareState | null {
  return compareState ? { ...compareState, viewing } : null;
}

export function materializeSnapshotProject(snapshot: NamedSnapshot | null): MidiProject | null {
  return snapshot ? materializeEditorProject(snapshot.state) : null;
}

export function buildComparePreview(
  compareState: CompareState | null,
  snapshots: readonly NamedSnapshot[],
  current: CurrentEditorCompareState,
): ComparePreview {
  if (!compareState || compareState.viewing === "A") {
    return { project: current.project, matching: null };
  }

  const targetSnapshot = snapshots.find(
    (snapshot) => snapshot.id === compareState.targetSnapshotId,
  );
  if (!targetSnapshot) {
    return { project: current.project, matching: null };
  }

  const targetProject = materializeSnapshotProject(targetSnapshot);
  const currentSide = toDiffSide(current, current.assignmentProvenance);
  const targetSide = toDiffSide(targetSnapshot.state, targetSnapshot.assignmentProvenance);
  const matching = currentSide && targetSide ? matchVoices(currentSide, targetSide) : null;

  return { project: compareState.viewing === "B" ? targetProject : current.project, matching };
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
