import { applyRangePatchPreservingHandCorrections } from "../../domain/midi/rangeRules";
import { nextVoiceId } from "../../domain/midi/voiceManagement";
import type { MidiProject } from "../../domain/midi/midiProject";
import type { VoiceOverrides } from "../../domain/midi/voiceAssignments";
import type { AssignmentProvenance, EditorDocument } from "./editorDocument";

export type EditorCommand =
  | { readonly kind: "assignNotes"; readonly noteIds: readonly string[]; readonly voiceId: string }
  | { readonly kind: "createVoice"; readonly assignSelection?: readonly string[] }
  | { readonly kind: "renameVoice"; readonly voiceId: string; readonly label: string }
  | { readonly kind: "mergeVoice"; readonly from: string; readonly to: string }
  | { readonly kind: "reorderVoice"; readonly voiceId: string; readonly direction: -1 | 1 }
  | {
      readonly kind: "applyRangeAssignments";
      readonly assignments: ReadonlyMap<string, string>;
    }
  | { readonly kind: "paintNotes"; readonly noteIds: readonly string[]; readonly voiceId: string }
  | {
      readonly kind: "replaceProject";
      readonly project: MidiProject;
      readonly provenance: AssignmentProvenance;
      readonly voiceOrder: readonly string[];
    }
  | { readonly kind: "restoreDocument"; readonly document: EditorDocument };

interface DocumentChanges {
  project?: MidiProject | null;
  voiceOverrides?: VoiceOverrides;
  voiceOrder?: readonly string[];
  voiceLabels?: Readonly<Record<string, string>>;
  rangeAssignedNoteIds?: ReadonlySet<string>;
  assignmentProvenance?: AssignmentProvenance;
}

function normalizeRangeAssignedNoteIds(
  rangeAssignedNoteIds: ReadonlySet<string>,
  voiceOverrides: VoiceOverrides,
): Set<string> {
  return new Set(
    Array.from(rangeAssignedNoteIds).filter((noteId) =>
      Object.prototype.hasOwnProperty.call(voiceOverrides, noteId),
    ),
  );
}

/**
 * Commits one pure editor transaction. Every command gets a fresh document
 * with a bumped revision, even when its requested edit is a safe no-op. That
 * keeps the reducer total and lets the future branch layer choose which
 * commands are worth placing in history without creating another mutation
 * path.
 */
function commitDocument(doc: EditorDocument, changes: DocumentChanges = {}): EditorDocument {
  const voiceOverrides = { ...(changes.voiceOverrides ?? doc.voiceOverrides) };
  const rangeAssignedNoteIds = normalizeRangeAssignedNoteIds(
    changes.rangeAssignedNoteIds ?? doc.rangeAssignedNoteIds,
    voiceOverrides,
  );

  return {
    documentId: doc.documentId,
    revision: doc.revision + 1,
    project: Object.prototype.hasOwnProperty.call(changes, "project")
      ? changes.project!
      : doc.project,
    voiceOverrides,
    voiceOrder: [...(changes.voiceOrder ?? doc.voiceOrder)],
    voiceLabels: { ...(changes.voiceLabels ?? doc.voiceLabels) },
    rangeAssignedNoteIds,
    assignmentProvenance: changes.assignmentProvenance ?? doc.assignmentProvenance,
  };
}

function assignNotes(
  doc: EditorDocument,
  noteIds: readonly string[],
  voiceId: string,
): EditorDocument {
  const voiceOverrides = { ...doc.voiceOverrides };
  const rangeAssignedNoteIds = new Set(doc.rangeAssignedNoteIds);

  for (const noteId of noteIds) {
    voiceOverrides[noteId] = voiceId;
    rangeAssignedNoteIds.delete(noteId);
  }

  return commitDocument(doc, { voiceOverrides, rangeAssignedNoteIds });
}

function mergeVoice(doc: EditorDocument, from: string, to: string): EditorDocument {
  if (!doc.project || from === to || to === "") {
    return commitDocument(doc);
  }

  const voiceOverrides = { ...doc.voiceOverrides };
  const rangeAssignedNoteIds = new Set(doc.rangeAssignedNoteIds);

  for (const note of doc.project.notes) {
    const assignedVoiceId = voiceOverrides[note.id] ?? note.voiceId;
    if (assignedVoiceId === from) {
      voiceOverrides[note.id] = to;
      rangeAssignedNoteIds.delete(note.id);
    }
  }

  return commitDocument(doc, {
    voiceOverrides,
    voiceOrder: doc.voiceOrder.filter((voiceId) => voiceId !== from),
    rangeAssignedNoteIds,
  });
}

/** The sole editor mutation boundary. It is pure, total, and unwired in A1. */
export function applyEditorCommand(doc: EditorDocument, command: EditorCommand): EditorDocument {
  switch (command.kind) {
    case "assignNotes":
    case "paintNotes":
      return assignNotes(doc, command.noteIds, command.voiceId);

    case "createVoice": {
      const voiceId = nextVoiceId(doc.voiceOrder);
      const voiceOverrides = { ...doc.voiceOverrides };
      const rangeAssignedNoteIds = new Set(doc.rangeAssignedNoteIds);

      for (const noteId of command.assignSelection ?? []) {
        voiceOverrides[noteId] = voiceId;
        rangeAssignedNoteIds.delete(noteId);
      }

      return commitDocument(doc, {
        voiceOverrides,
        voiceOrder: [...doc.voiceOrder, voiceId],
        rangeAssignedNoteIds,
      });
    }

    case "renameVoice":
      return commitDocument(doc, {
        voiceLabels: { ...doc.voiceLabels, [command.voiceId]: command.label },
      });

    case "mergeVoice":
      return mergeVoice(doc, command.from, command.to);

    case "reorderVoice": {
      const index = doc.voiceOrder.indexOf(command.voiceId);
      const targetIndex = index + command.direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= doc.voiceOrder.length) {
        return commitDocument(doc);
      }

      const voiceOrder = [...doc.voiceOrder];
      [voiceOrder[index], voiceOrder[targetIndex]] = [voiceOrder[targetIndex], voiceOrder[index]];
      return commitDocument(doc, { voiceOrder });
    }

    case "applyRangeAssignments": {
      const rangePatch = Object.fromEntries(command.assignments);
      const { overrides, rangeAssignedNoteIds } = applyRangePatchPreservingHandCorrections(
        doc.voiceOverrides,
        doc.rangeAssignedNoteIds,
        rangePatch,
      );
      return commitDocument(doc, { voiceOverrides: overrides, rangeAssignedNoteIds });
    }

    case "replaceProject":
      return commitDocument(doc, {
        project: command.project,
        assignmentProvenance: command.provenance,
        voiceOrder: command.voiceOrder,
      });

    case "restoreDocument":
      return commitDocument(doc, {
        project: command.document.project,
        voiceOverrides: command.document.voiceOverrides,
        voiceOrder: command.document.voiceOrder,
        voiceLabels: command.document.voiceLabels,
        rangeAssignedNoteIds: command.document.rangeAssignedNoteIds,
        assignmentProvenance: command.document.assignmentProvenance,
      });
  }
}
