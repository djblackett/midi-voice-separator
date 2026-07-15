import {
  changedNoteIdsForSide,
  type CrossImportAssignmentDiff,
} from "../../domain/midi/crossImportDiff";

export type CrossImportPaneSide = "reference" | "editable";

export interface CrossImportPaneOverlay {
  readonly changedNoteIds: ReadonlySet<string>;
  readonly previousVoiceId: ReadonlyMap<string, string>;
}

const EMPTY_OVERLAY: CrossImportPaneOverlay = {
  changedNoteIds: new Set(),
  previousVoiceId: new Map(),
};

/**
 * Adapts side-qualified pairs to a single pane only after its document is
 * validated. Cross-import parser ids never leak into the other canvas.
 */
export function resolveCrossImportPaneOverlay(
  diff: CrossImportAssignmentDiff | null,
  target: { readonly side: CrossImportPaneSide; readonly documentId: string },
): CrossImportPaneOverlay {
  if (
    !diff ||
    (target.side === "reference" && target.documentId !== diff.referenceDocumentId) ||
    (target.side === "editable" && target.documentId !== diff.editableDocumentId)
  ) {
    return EMPTY_OVERLAY;
  }

  const previousVoiceId = new Map<string, string>();
  for (const pair of diff.changedPairs) {
    if (target.side === "reference") {
      previousVoiceId.set(pair.reference.noteId, pair.editableVoice.voiceId);
    } else {
      previousVoiceId.set(pair.editable.noteId, pair.referenceVoice.voiceId);
    }
  }
  return {
    changedNoteIds: new Set(changedNoteIdsForSide(diff, target)),
    previousVoiceId,
  };
}
