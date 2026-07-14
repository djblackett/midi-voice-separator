import type { AssignmentProvenance } from "../domain/midi/assignmentProvenance";
import type { MidiProject } from "../domain/midi/midiProject";

/** Opaque, session-local owner for an immutable imported comparison file. */
export type ReferenceDocumentId = string;

/**
 * An external import is intentionally not an EditorDocument: it has no
 * history, correction layer, branch id, or promotion path.
 */
export interface ReferenceDocument {
  readonly documentId: ReferenceDocumentId;
  readonly sourcePath: string;
  readonly importedAt: number;
  readonly project: MidiProject;
  readonly assignmentProvenance: AssignmentProvenance;
}

let nextReferenceDocumentSequence = 1;

export function createReferenceDocumentId(): ReferenceDocumentId {
  const id = `reference-${nextReferenceDocumentSequence}`;
  nextReferenceDocumentSequence += 1;
  return id;
}

/** Exposed for deterministic tests; reference IDs are not persisted identity. */
export function resetReferenceDocumentIdSequence(): void {
  nextReferenceDocumentSequence = 1;
}

export function createReferenceDocument(input: ReferenceDocument): ReferenceDocument {
  return {
    documentId: input.documentId,
    sourcePath: input.sourcePath,
    importedAt: input.importedAt,
    project: input.project,
    assignmentProvenance: input.assignmentProvenance,
  };
}
