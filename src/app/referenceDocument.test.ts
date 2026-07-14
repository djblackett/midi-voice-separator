import { describe, expect, it } from "vitest";
import type { MidiProject } from "../domain/midi/midiProject";
import {
  createReferenceDocument,
  createReferenceDocumentId,
  resetReferenceDocumentIdSequence,
} from "./referenceDocument";

function project(): MidiProject {
  return {
    fileName: "reference.mid",
    format: "parallel",
    ppq: 480,
    durationTicks: 0,
    trackCount: 0,
    voices: [],
    notes: [],
    tempoChanges: [],
    timeSignatures: [],
    warnings: [],
    separationSummary: { meanConfidence: 1, lowConfidenceNoteCount: 0, voiceCount: 0 },
    strategySuggestion: { strategy: "BALANCED", reason: "fixture" },
  };
}

describe("ReferenceDocument", () => {
  it("mints session-local opaque IDs without treating them as content identity", () => {
    resetReferenceDocumentIdSequence();

    expect(createReferenceDocumentId()).toBe("reference-1");
    expect(createReferenceDocumentId()).toBe("reference-2");
  });

  it("owns only immutable import data, never editor correction or history fields", () => {
    const reference = createReferenceDocument({
      documentId: "reference-1",
      sourcePath: "C:/music/reference.mid",
      importedAt: 1234,
      project: project(),
      assignmentProvenance: { kind: "imported", algorithmVersion: 1 },
    });

    expect(reference).toEqual({
      documentId: "reference-1",
      sourcePath: "C:/music/reference.mid",
      importedAt: 1234,
      project: project(),
      assignmentProvenance: { kind: "imported", algorithmVersion: 1 },
    });
    expect("voiceOverrides" in reference).toBe(false);
    expect("history" in reference).toBe(false);
  });
});
