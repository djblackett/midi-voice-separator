import type { AssignmentProvenance } from "../../domain/midi/assignmentProvenance";
import type { MidiProject } from "../../domain/midi/midiProject";
import type { VoiceOverrides } from "../../domain/midi/voiceAssignments";

export type DocumentId = string;

export type { AssignmentProvenance } from "../../domain/midi/assignmentProvenance";

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
