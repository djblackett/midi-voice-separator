import type { MidiProject } from "../../domain/midi/midiProject";
import { materializeEditorProject } from "../../domain/midi/editorMaterialization";
import { correspondVoices, type VoiceCorrespondence } from "../../domain/midi/voiceCorrespondence";
import { derivePresentationKeys } from "../../features/piano-roll/presentationKeys";
import type { ComparisonWorkspace } from "../editorCompare";
import type { ComparisonBranches } from "./comparisonBranches";
import type { BranchId } from "./editorBranch";
import type { EditorDocument } from "./editorDocument";

export interface RevisionRef {
  readonly branchId: BranchId;
  readonly revision: number;
}

export interface SideProjection {
  readonly side: BranchId;
  readonly document: EditorDocument;
  readonly project: MidiProject | null;
  /** True only for the active side (edits and inspectors bind here). */
  readonly editable: boolean;
  readonly revisionRef: RevisionRef;
  /** voiceId -> presentation key for this side's canvas (empty = identity colors). */
  readonly presentationKeyByVoiceId: ReadonlyMap<string, string>;
}

/**
 * The single resolver that decides what renders, what edits, and how voices map
 * to presentation (M11). Render/edit/selection all read from this so side B can
 * never be visible while commands target side A. Comparison stays a pure
 * projection over branch references -- it materializes but never stores.
 */
export interface ComparisonProjection {
  readonly visibleSides: readonly BranchId[];
  readonly activeSide: BranchId;
  readonly sideA: SideProjection;
  readonly sideB: SideProjection | null;
  readonly correspondence: VoiceCorrespondence | null;
}

function assignmentsOf(project: MidiProject): Map<string, string> {
  return new Map(project.notes.map((note) => [note.id, note.voiceId]));
}

export function resolveComparisonProjection(
  branches: ComparisonBranches,
  workspace: ComparisonWorkspace | null,
): ComparisonProjection {
  const { activeSide } = branches;
  const aDocument = branches.A.present;
  const bBranch = branches.B;
  const bDocument = bBranch?.present ?? null;
  const aProject = materializeEditorProject(aDocument);
  const bProject = bDocument ? materializeEditorProject(bDocument) : null;

  const isSplit = workspace?.layout === "split" && bDocument !== null;

  // Correspondence and presentation keys only matter when both sides render at
  // once; a single canvas shows one side in its own colors.
  let correspondence: VoiceCorrespondence | null = null;
  let bPresentationKeyByVoiceId: ReadonlyMap<string, string> = new Map();
  if (isSplit && aProject && bProject) {
    correspondence = correspondVoices(
      { voiceIds: aProject.voices.map((voice) => voice.id), assignments: assignmentsOf(aProject) },
      { voiceIds: bProject.voices.map((voice) => voice.id), assignments: assignmentsOf(bProject) },
    );
    const presentation = derivePresentationKeys(correspondence);
    const map = new Map<string, string>();
    for (const voice of bProject.voices) {
      const key = presentation.keyForSide("B", voice.id);
      if (key !== voice.id) {
        map.set(voice.id, key);
      }
    }
    bPresentationKeyByVoiceId = map;
  }

  const sideA: SideProjection = {
    side: "A",
    document: aDocument,
    project: aProject,
    editable: activeSide === "A",
    revisionRef: { branchId: "A", revision: aDocument.revision },
    presentationKeyByVoiceId: new Map(), // A is the canonical palette.
  };
  const sideB: SideProjection | null =
    bBranch && bDocument
      ? {
          side: "B",
          document: bDocument,
          project: bProject,
          editable: activeSide === "B",
          revisionRef: { branchId: "B", revision: bDocument.revision },
          presentationKeyByVoiceId: bPresentationKeyByVoiceId,
        }
      : null;

  return {
    visibleSides: isSplit ? ["A", "B"] : [activeSide],
    activeSide,
    sideA,
    sideB,
    correspondence,
  };
}

/** The projection for the side the single-canvas layout should render. */
export function singleLayoutSide(projection: ComparisonProjection): SideProjection {
  return projection.activeSide === "B" && projection.sideB ? projection.sideB : projection.sideA;
}
