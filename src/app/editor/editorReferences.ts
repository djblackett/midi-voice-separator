import type { BranchId } from "./editorBranch";
import type { DocumentId } from "./editorDocument";

/**
 * Identifies one live editor side. This is a semantic alias for the branch
 * identifier: a branch is the only editable side until the workspace layer
 * arrives in Phase D.
 */
export type SideId = BranchId;

/**
 * A note address is meaningful only inside the document that owns it.
 *
 * Parser note IDs intentionally remain plain local strings. Code operating
 * across documents must carry this reference instead of treating a note ID as
 * globally stable content identity.
 */
export interface NoteRef {
  readonly documentId: DocumentId;
  readonly noteId: string;
}

/**
 * A voice ID is meaningful only on the side that produced that assignment.
 * It must not be carried across re-runs or imports as durable identity.
 */
export interface VoiceRef {
  readonly sideId: SideId;
  readonly voiceId: string;
}
