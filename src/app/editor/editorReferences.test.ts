import { describe, expect, expectTypeOf, it } from "vitest";
import type { BranchId } from "./editorBranch";
import type { DocumentId } from "./editorDocument";
import type { NoteRef, SideId, VoiceRef } from "./editorReferences";

describe("side-scoped editor references", () => {
  it("keeps a parser note id local while requiring its document address", () => {
    const reference: NoteRef = { documentId: "document-a", noteId: "track-0-note-12" };

    expect(reference).toEqual({ documentId: "document-a", noteId: "track-0-note-12" });
    expectTypeOf(reference.documentId).toEqualTypeOf<DocumentId>();
    expectTypeOf(reference.noteId).toEqualTypeOf<string>();
  });

  it("qualifies a voice id with the editable side that owns its assignment", () => {
    const reference: VoiceRef = { sideId: "B", voiceId: "voice-2" };

    expect(reference).toEqual({ sideId: "B", voiceId: "voice-2" });
    expectTypeOf(reference.sideId).toEqualTypeOf<SideId>();
    expectTypeOf<SideId>().toEqualTypeOf<BranchId>();
    expectTypeOf(reference.voiceId).toEqualTypeOf<string>();
  });
});
