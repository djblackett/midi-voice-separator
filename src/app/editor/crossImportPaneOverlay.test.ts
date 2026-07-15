import { describe, expect, it } from "vitest";
import type { CrossImportAssignmentDiff } from "../../domain/midi/crossImportDiff";
import { resolveCrossImportPaneOverlay } from "./crossImportPaneOverlay";

const diff: CrossImportAssignmentDiff = {
  comparable: true,
  referenceDocumentId: "reference-1",
  editableDocumentId: "A",
  matcher: {
    matcherVersion: 1,
    policy: "CROSS_IMPORT_V1",
    referenceCoverage: { total: 1, exact: 1, fuzzy: 0, ambiguous: 0, unmatched: 0 },
    editableCoverage: { total: 1, exact: 1, fuzzy: 0, ambiguous: 0, unmatched: 0 },
    exactPairCount: 1,
    fuzzyPairCount: 0,
  },
  trustedPairCoverage: { reference: 1, editable: 1 },
  changedPairs: [
    {
      reference: { documentId: "reference-1", noteId: "reference-note" },
      editable: { documentId: "A", noteId: "editable-note" },
      referenceVoice: { documentId: "reference-1", voiceId: "reference-lead" },
      editableVoice: { documentId: "A", voiceId: "voice-2" },
    },
  ],
  matchedVoices: [],
  addedEditableVoices: [],
  removedReferenceVoices: [],
  ambiguous: [],
  unmatchedReference: [],
  unmatchedEditable: [],
};

describe("resolveCrossImportPaneOverlay", () => {
  it("maps changed-note cues and opposite voice edges only into the authorized pane", () => {
    const reference = resolveCrossImportPaneOverlay(diff, {
      side: "reference",
      documentId: "reference-1",
    });
    const editable = resolveCrossImportPaneOverlay(diff, { side: "editable", documentId: "A" });

    expect(reference.changedNoteIds).toEqual(new Set(["reference-note"]));
    expect(reference.previousVoiceId.get("reference-note")).toBe("voice-2");
    expect(editable.changedNoteIds).toEqual(new Set(["editable-note"]));
    expect(editable.previousVoiceId.get("editable-note")).toBe("reference-lead");
  });

  it("returns no local ids or colors when a pane claims the wrong document", () => {
    const overlay = resolveCrossImportPaneOverlay(diff, {
      side: "editable",
      documentId: "other-document",
    });

    expect(overlay.changedNoteIds).toEqual(new Set());
    expect(overlay.previousVoiceId).toEqual(new Map());
  });
});
