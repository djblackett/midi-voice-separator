import { describe, expect, it } from "vitest";
import type { CorrespondenceSide } from "./voiceCorrespondence";
import { reconcileVoicesAfterReassign } from "./voiceReconciliation";

function side(assignments: Record<string, string>): CorrespondenceSide {
  return {
    voiceIds: [...new Set(Object.values(assignments))].sort(),
    assignments: new Map(Object.entries(assignments)),
  };
}

describe("reconcileVoicesAfterReassign", () => {
  it("carries labels and order onto reallocated voice ids", () => {
    // Same two groupings, fresh ids (voice-1/2 -> voice-5/6) as a full re-run
    // produces.
    const before = side({ n1: "voice-1", n2: "voice-1", n3: "voice-2" });
    const after = side({ n1: "voice-5", n2: "voice-5", n3: "voice-6" });

    const result = reconcileVoicesAfterReassign(before, after, ["voice-1", "voice-2"], {
      "voice-1": "Lead",
      "voice-2": "Bass",
    });

    expect(result.oldToNew.get("voice-1")).toBe("voice-5");
    expect(result.oldToNew.get("voice-2")).toBe("voice-6");
    expect(result.voiceOrder).toEqual(["voice-5", "voice-6"]);
    expect(result.voiceLabels).toEqual({ "voice-5": "Lead", "voice-6": "Bass" });
  });

  it("preserves the user's voice order across the re-run", () => {
    const before = side({ n1: "voice-1", n2: "voice-2" });
    const after = side({ n1: "voice-8", n2: "voice-9" });
    // User had ordered Bass (voice-2) before Lead (voice-1).
    const result = reconcileVoicesAfterReassign(before, after, ["voice-2", "voice-1"], {});
    expect(result.voiceOrder).toEqual(["voice-9", "voice-8"]);
  });

  it("appends genuinely new voices after the corresponded ones", () => {
    const before = side({ n1: "voice-1" });
    // The re-run split n2 out into a brand-new voice with no old counterpart.
    const after = side({ n1: "voice-5", n2: "voice-6" });
    const result = reconcileVoicesAfterReassign(before, after, ["voice-1"], { "voice-1": "Lead" });
    expect(result.voiceOrder).toEqual(["voice-5", "voice-6"]);
    expect(result.voiceLabels).toEqual({ "voice-5": "Lead" });
  });

  it("keeps a label when a voice id is unchanged across the re-run", () => {
    const before = side({ n1: "voice-1", n2: "voice-2" });
    const after = side({ n1: "voice-1", n2: "voice-7" });
    const result = reconcileVoicesAfterReassign(before, after, ["voice-1", "voice-2"], {
      "voice-1": "Lead",
      "voice-2": "Bass",
    });
    expect(result.voiceLabels).toEqual({ "voice-1": "Lead", "voice-7": "Bass" });
  });
});
