import { describe, expect, it } from "vitest";
import { canApplyCrossImportResult, type CrossImportRequestRef } from "./crossImportGuard";

describe("canApplyCrossImportResult", () => {
  const request: CrossImportRequestRef = {
    requestId: 3,
    branchId: "A",
    documentId: "document-a",
    revision: 7,
    referenceDocumentId: "reference-1",
  };

  it("authorizes only the exact request target", () => {
    expect(canApplyCrossImportResult(request, request)).toBe(true);
  });

  it.each([
    ["a newer request", { ...request, requestId: 4 }],
    ["another editable branch", { ...request, branchId: "B" as const }],
    ["a replaced document", { ...request, documentId: "document-b" }],
    ["an edited revision", { ...request, revision: 8 }],
    ["a replacement reference", { ...request, referenceDocumentId: "reference-2" }],
  ])("rejects %s", (_label, current) => {
    expect(canApplyCrossImportResult(request, current)).toBe(false);
  });
});
