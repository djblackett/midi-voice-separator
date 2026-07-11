import { describe, expect, it } from "vitest";
import { canApplyRerunResult } from "./rerunGuard";

describe("canApplyRerunResult", () => {
  const request = { branchId: "A" as const, revision: 7, requestId: 3 };

  it("authorizes the result only at its originating branch revision", () => {
    expect(canApplyRerunResult(request, { branchId: "A", revision: 7, requestId: 3 })).toBe(true);
  });

  it("drops a result when an edit advanced the target revision", () => {
    expect(canApplyRerunResult(request, { branchId: "A", revision: 8, requestId: 3 })).toBe(false);
  });

  it("drops a result that belongs to another branch", () => {
    expect(canApplyRerunResult(request, { branchId: "B", revision: 7, requestId: 3 })).toBe(false);
  });

  it("drops an older request even when its branch revision still matches", () => {
    expect(canApplyRerunResult(request, { branchId: "A", revision: 7, requestId: 4 })).toBe(false);
  });
});
