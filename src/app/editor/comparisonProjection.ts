import type { CrossImportAssignmentDiff } from "../../domain/midi/crossImportDiff";
import { materializeEditorProject } from "../../domain/midi/editorMaterialization";
import type { MidiProject } from "../../domain/midi/midiProject";
import { correspondVoices, type VoiceCorrespondence } from "../../domain/midi/voiceCorrespondence";
import { derivePresentationKeys } from "../../features/piano-roll/presentationKeys";
import type { ComparisonWorkspace } from "../editorCompare";
import type { ReferenceDocument } from "../referenceDocument";
import type { ComparisonBranches } from "./comparisonBranches";
import type { BranchId } from "./editorBranch";
import type { EditorDocument } from "./editorDocument";

export type ComparisonPaneId = BranchId | "reference";

export interface RevisionRef {
  readonly branchId: BranchId;
  readonly revision: number;
}

export interface EditablePaneProjection {
  readonly kind: "editable";
  readonly side: BranchId;
  readonly document: EditorDocument;
  readonly project: MidiProject | null;
  /** True only for the active side (edits and inspectors bind here). */
  readonly editable: boolean;
  readonly revisionRef: RevisionRef;
  /** voiceId -> presentation key for this side's canvas (empty = identity colors). */
  readonly presentationKeyByVoiceId: ReadonlyMap<string, string>;
}

/** A pane owner with no command, history, or editable-document capability. */
export interface ReferencePaneProjection {
  readonly kind: "reference";
  readonly side: "reference";
  readonly document: ReferenceDocument;
  readonly project: MidiProject;
  readonly editable: false;
  readonly presentationKeyByVoiceId: ReadonlyMap<string, string>;
}

export type ComparisonPaneProjection = EditablePaneProjection | ReferencePaneProjection;

/** Compatibility name for callers that can only receive an editable pane. */
export type SideProjection = EditablePaneProjection;

/**
 * Derived state supplied only after the guarded controller has accepted a
 * response. The reference can still project for inspection when `diff` is
 * null/out of date; it simply gets no cross-import palette sharing.
 */
export interface ExternalReferenceProjectionInput {
  readonly reference: ReferenceDocument;
  readonly diff: CrossImportAssignmentDiff | null;
}

/**
 * The single resolver that decides what renders, what edits, and how voices map
 * to presentation. It stays a pure projection over editable branches plus an
 * optional immutable reference -- never a place that manufactures a branch
 * from the external import.
 */
export interface ComparisonProjection {
  readonly visibleSides: readonly ComparisonPaneId[];
  readonly activeSide: BranchId;
  readonly sideA: EditablePaneProjection;
  readonly sideB: EditablePaneProjection | null;
  readonly reference: ReferencePaneProjection | null;
  /** Same-lineage A/B correspondence only; external pairs never enter it. */
  readonly correspondence: VoiceCorrespondence | null;
}

function assignmentsOf(project: MidiProject): Map<string, string> {
  return new Map(project.notes.map((note) => [note.id, note.voiceId]));
}

export function resolveComparisonProjection(
  branches: ComparisonBranches,
  workspace: ComparisonWorkspace | null,
  externalReference: ExternalReferenceProjectionInput | null = null,
): ComparisonProjection {
  const { activeSide } = branches;
  const aDocument = branches.A.present;
  const bBranch = branches.B;
  const bDocument = bBranch?.present ?? null;
  const aProject = materializeEditorProject(aDocument);
  const bProject = bDocument ? materializeEditorProject(bDocument) : null;

  // Correspondence + presentation keys are resolved whenever B exists: split
  // rendering consumes them for color, and monitored playback for timbre, so a
  // matched B voice looks and sounds like its A partner even in single view.
  let correspondence: VoiceCorrespondence | null = null;
  let bPresentationKeyByVoiceId: ReadonlyMap<string, string> = new Map();
  if (bDocument !== null && aProject && bProject) {
    correspondence = correspondVoices(
      { voiceIds: aProject.voices.map((voice) => voice.id), assignments: assignmentsOf(aProject) },
      { voiceIds: bProject.voices.map((voice) => voice.id), assignments: assignmentsOf(bProject) },
    );
    const presentation = derivePresentationKeys(correspondence);
    bPresentationKeyByVoiceId = presentationKeysFor(bProject, (voiceId) =>
      presentation.keyForSide("B", voiceId),
    );
  }

  const sideA: EditablePaneProjection = {
    kind: "editable",
    side: "A",
    document: aDocument,
    project: aProject,
    editable: activeSide === "A",
    revisionRef: { branchId: "A", revision: aDocument.revision },
    presentationKeyByVoiceId: new Map(), // A is the canonical palette.
  };
  const sideB: EditablePaneProjection | null =
    bBranch && bDocument
      ? {
          kind: "editable",
          side: "B",
          document: bDocument,
          project: bProject,
          editable: activeSide === "B",
          revisionRef: { branchId: "B", revision: bDocument.revision },
          presentationKeyByVoiceId: bPresentationKeyByVoiceId,
        }
      : null;
  const reference = resolveReferencePane(workspace, externalReference);

  return {
    visibleSides: visibleSidesFor(workspace, activeSide, reference),
    activeSide,
    sideA,
    sideB,
    reference,
    correspondence,
  };
}

/** The pane the single-canvas layout should render. */
export function singleLayoutSide(projection: ComparisonProjection): ComparisonPaneProjection {
  return projection.visibleSides[0] === "reference" && projection.reference
    ? projection.reference
    : projection.visibleSides[0] === "B" && projection.sideB
      ? projection.sideB
      : projection.sideA;
}

/** Safely turns an optional presentation override into the actual color key. */
export function presentationKeyForVoice(pane: ComparisonPaneProjection, voiceId: string): string {
  return pane.presentationKeyByVoiceId.get(voiceId) ?? voiceId;
}

function resolveReferencePane(
  workspace: ComparisonWorkspace | null,
  input: ExternalReferenceProjectionInput | null,
): ReferencePaneProjection | null {
  if (
    workspace?.kind !== "externalReference" ||
    !input ||
    input.reference.documentId !== workspace.referenceDocumentId
  ) {
    return null;
  }
  const presentation = input.diff
    ? derivePresentationKeys(
        {
          matched: input.diff.matchedVoices.map((pair) => ({
            aVoiceId: pair.editable.voiceId,
            bVoiceId: pair.reference.voiceId,
            overlap: pair.overlap,
          })),
          unmatchedA: input.diff.addedEditableVoices.map((voice) => voice.voiceId),
          unmatchedB: input.diff.removedReferenceVoices.map((voice) => voice.voiceId),
          ambiguous: [],
          splits: [],
          merges: [],
          matcherVersion: input.diff.matcher.matcherVersion,
        },
        { canonical: workspace.target.branchId, matched: "reference" },
      )
    : null;

  return {
    kind: "reference",
    side: "reference",
    document: input.reference,
    project: input.reference.project,
    editable: false,
    presentationKeyByVoiceId: presentation
      ? presentationKeysFor(input.reference.project, (voiceId) =>
          presentation.keyForSide("reference", voiceId),
        )
      : new Map(),
  };
}

function visibleSidesFor(
  workspace: ComparisonWorkspace | null,
  activeSide: BranchId,
  reference: ReferencePaneProjection | null,
): readonly ComparisonPaneId[] {
  if (workspace?.kind === "externalReference" && reference) {
    if (workspace.layout === "split") {
      return [workspace.target.branchId, "reference"];
    }
    return [workspace.viewing === "reference" ? "reference" : workspace.target.branchId];
  }
  return workspace?.kind === "editableSnapshot" && workspace.layout === "split"
    ? ["A", "B"]
    : [activeSide];
}

function presentationKeysFor(
  project: MidiProject,
  keyForVoice: (voiceId: string) => string,
): ReadonlyMap<string, string> {
  const keys = new Map<string, string>();
  for (const voice of project.voices) {
    const key = keyForVoice(voice.id);
    if (key !== voice.id) {
      keys.set(voice.id, key);
    }
  }
  return keys;
}
