import type { MidiProject, SeparationStrategy } from "../../domain/midi/midiProject";
import type { VoiceOverrides } from "../../domain/midi/voiceAssignments";

export type DocumentId = string;

/**
 * Describes the algorithmic assignment carried by the base project. This is
 * deliberately separate from the next-rerun UI preset and from evaluation
 * profiles: manual corrections live in the override layer instead.
 *
 * B1 will make the backend mint these values; the document owns the value now
 * so no later branch/history migration has to invent a provenance boundary.
 */
export type AssignmentProvenance =
  | { readonly kind: "imported"; readonly algorithmVersion: number }
  | { readonly kind: "appExportedVoiceTracks" }
  | {
      readonly kind: "reassigned";
      readonly strategy: SeparationStrategy;
      readonly mode: "GREEDY" | "GLOBAL" | "CONTIG";
      readonly maxVoiceCount: number | null;
      readonly algorithmVersion: number;
    };

/**
 * The complete, atomic editable value for one editor branch.
 *
 * `rangeAssignedNoteIds` is always normalized by `applyEditorCommand` so it
 * remains a subset of the keys in `voiceOverrides`.
 */
export interface EditorDocument {
  readonly documentId: DocumentId;
  readonly revision: number;
  readonly project: MidiProject | null;
  readonly voiceOverrides: VoiceOverrides;
  readonly voiceOrder: readonly string[];
  readonly voiceLabels: Readonly<Record<string, string>>;
  readonly rangeAssignedNoteIds: ReadonlySet<string>;
  readonly assignmentProvenance: AssignmentProvenance;
}
