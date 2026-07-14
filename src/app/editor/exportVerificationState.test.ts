import { describe, expect, it } from "vitest";
import type { ExportMidiResult } from "../../lib/tauri/commands";
import {
  createExportVerificationState,
  isExportVerificationCurrent,
  retainExportVerificationForTarget,
  type ExportVerificationTarget,
} from "./exportVerificationState";

const target: ExportVerificationTarget = {
  branchId: "A",
  documentId: "document-a",
  revision: 7,
};

const result: ExportMidiResult = {
  path: "C:/music/song-voices.mid",
  trackCount: 3,
  noteCount: 12,
  verification: {
    verifierVersion: 1,
    matcherVersion: 1,
    policy: "STRICT_ROUND_TRIP_V1",
    status: "VERIFIED",
    noteSummary: {
      expectedNoteCount: 12,
      reimportedNoteCount: 12,
      exactMatchMultiplicity: 12,
      contentPreserved: true,
      ambiguousExactGroupCount: 0,
      missingExpected: [],
      unexpectedReimported: [],
    },
    voicePartition: {
      unambiguousPairCount: 12,
      ambiguousDuplicateGroupCount: 0,
      comparable: true,
      preserved: true,
    },
    metadata: {
      ppqPreserved: true,
      durationPreserved: true,
      tempoMapPreserved: true,
      timeSignaturesPreserved: true,
    },
    differences: [],
  },
};

describe("export verification state", () => {
  const state = createExportVerificationState(target, result);

  it("retains the completed export result at its exact source revision", () => {
    expect(state).toMatchObject({
      ...target,
      exportPath: result.path,
      trackCount: result.trackCount,
      noteCount: result.noteCount,
      report: result.verification,
    });
    expect(isExportVerificationCurrent(state, target)).toBe(true);
  });

  it.each([
    ["a branch switch", { ...target, branchId: "B" as const }],
    ["a document replacement", { ...target, documentId: "document-b" }],
  ])("does not render after %s", (_label, current) => {
    expect(isExportVerificationCurrent(state, current)).toBe(false);
  });

  it("stays hidden after an edit followed by undo", () => {
    const afterEdit = retainExportVerificationForTarget(state, { ...target, revision: 8 });

    expect(afterEdit).toBeNull();
    expect(retainExportVerificationForTarget(afterEdit, target)).toBeNull();
  });

  it.each([
    ["an edit", { ...target, revision: 8 }],
    ["a branch switch", { ...target, branchId: "B" as const }],
    ["a document replacement", { ...target, documentId: "document-b" }],
  ])("drops %s immediately", (_label, current) => {
    expect(retainExportVerificationForTarget(state, current)).toBeNull();
  });
});
