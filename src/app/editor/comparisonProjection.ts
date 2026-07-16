import type { CrossImportAssignmentDiff } from "../../domain/midi/crossImportDiff";
import { materializeEditorProject } from "../../domain/midi/editorMaterialization";
import type { MidiProject } from "../../domain/midi/midiProject";
import type { VoiceCorrespondence } from "../../domain/midi/voiceCorrespondence";
import { deriveVoiceOrderPresentationKeys } from "../../features/piano-roll/presentationKeys";
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
  const aPresentationKeyByVoiceId = aProject
    ? deriveVoiceOrderPresentationKeys(aProject.voices.map((voice) => voice.id))
    : new Map<string, string>();
  const bPresentationKeyByVoiceId = bProject
    ? new Map(deriveVoiceOrderPresentationKeys(bProject.voices.map((voice) => voice.id)))
    : new Map<string, string>();

  // Cross-side identity is frozen when B is forked. Recomputing it from live
  // assignments would let one selected edit remap an entire B voice and make
  // untouched notes appear to change color.
  const correspondence: VoiceCorrespondence | null =
    bDocument !== null && aProject && bProject ? branches.correspondence : null;
  if (correspondence) {
    for (const pair of correspondence.matched) {
      const canonicalKey = aPresentationKeyByVoiceId.get(pair.aVoiceId);
      if (canonicalKey && bPresentationKeyByVoiceId.has(pair.bVoiceId)) {
        bPresentationKeyByVoiceId.set(pair.bVoiceId, canonicalKey);
      }
    }
  }

  const sideA: EditablePaneProjection = {
    kind: "editable",
    side: "A",
    document: aDocument,
    project: aProject,
    editable: activeSide === "A",
    revisionRef: { branchId: "A", revision: aDocument.revision },
    presentationKeyByVoiceId: aPresentationKeyByVoiceId,
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
  const editablePresentationKeyByVoiceId =
    workspace?.kind === "externalReference" && workspace.target.branchId === "B"
      ? bPresentationKeyByVoiceId
      : aPresentationKeyByVoiceId;
  const reference = resolveReferencePane(
    workspace,
    externalReference,
    editablePresentationKeyByVoiceId,
  );

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
  editablePresentationKeyByVoiceId: ReadonlyMap<string, string>,
): ReferencePaneProjection | null {
  if (
    workspace?.kind !== "externalReference" ||
    !input ||
    input.reference.documentId !== workspace.referenceDocumentId
  ) {
    return null;
  }
  const presentationKeyByVoiceId = new Map(
    deriveVoiceOrderPresentationKeys(input.reference.project.voices.map((voice) => voice.id)),
  );
  for (const pair of input.diff?.matchedVoices ?? []) {
    const canonicalKey = editablePresentationKeyByVoiceId.get(pair.editable.voiceId);
    if (canonicalKey && presentationKeyByVoiceId.has(pair.reference.voiceId)) {
      presentationKeyByVoiceId.set(pair.reference.voiceId, canonicalKey);
    }
  }

  return {
    kind: "reference",
    side: "reference",
    document: input.reference,
    project: input.reference.project,
    editable: false,
    presentationKeyByVoiceId,
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
