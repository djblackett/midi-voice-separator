import { describe, expect, it } from "vitest";
import type { VoiceCorrespondence } from "../../domain/midi/voiceCorrespondence";
import { resolveLinkedLaneTarget } from "./laneViewportLink";

function correspondence(overrides: Partial<VoiceCorrespondence> = {}): VoiceCorrespondence {
  return {
    matched: [
      { aVoiceId: "a-lead", bVoiceId: "b-lead", overlap: 4 },
      { aVoiceId: "a-bass", bVoiceId: "b-bass", overlap: 3 },
    ],
    unmatchedA: [],
    unmatchedB: [],
    ambiguous: [],
    splits: [],
    merges: [],
    matcherVersion: 1,
    ...overrides,
  };
}

describe("resolveLinkedLaneTarget", () => {
  it("maps A to B and B to A through correspondence", () => {
    expect(resolveLinkedLaneTarget("A", "a-lead", correspondence())).toEqual({
      kind: "matched",
      targetSide: "B",
      targetVoiceId: "b-lead",
    });
    expect(resolveLinkedLaneTarget("B", "b-bass", correspondence())).toEqual({
      kind: "matched",
      targetSide: "A",
      targetVoiceId: "a-bass",
    });
  });

  it("maps percussion only when correspondence contains its semantic pair", () => {
    const withPercussion = correspondence({
      matched: [
        ...correspondence().matched,
        {
          aVoiceId: "percussion",
          bVoiceId: "percussion",
          overlap: 2,
        },
      ],
    });

    expect(resolveLinkedLaneTarget("A", "percussion", withPercussion)).toEqual({
      kind: "matched",
      targetSide: "B",
      targetVoiceId: "percussion",
    });
  });

  it("rejects missing correspondence and unmatched voices", () => {
    expect(resolveLinkedLaneTarget("A", "a-lead", null)).toEqual({
      kind: "unresolved",
      targetSide: "B",
      reason: "missing-correspondence",
    });
    expect(resolveLinkedLaneTarget("A", "a-extra", correspondence())).toEqual({
      kind: "unresolved",
      targetSide: "B",
      reason: "unmatched",
    });
    expect(resolveLinkedLaneTarget("A", "same-id", correspondence({ matched: [] }))).toEqual({
      kind: "unresolved",
      targetSide: "B",
      reason: "unmatched",
    });
  });

  it("rejects ambiguity on the source endpoint", () => {
    const ambiguous = correspondence({
      ambiguous: [{ side: "A", voiceId: "a-lead" }],
    });

    expect(resolveLinkedLaneTarget("A", "a-lead", ambiguous)).toEqual({
      kind: "unresolved",
      targetSide: "B",
      reason: "ambiguous",
    });
  });

  it("rejects ambiguity on the target endpoint", () => {
    const ambiguous = correspondence({
      ambiguous: [{ side: "B", voiceId: "b-lead" }],
    });

    expect(resolveLinkedLaneTarget("A", "a-lead", ambiguous)).toEqual({
      kind: "unresolved",
      targetSide: "B",
      reason: "ambiguous",
    });
  });
});
