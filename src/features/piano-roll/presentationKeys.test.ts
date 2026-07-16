import { describe, expect, it } from "vitest";
import type { VoiceCorrespondence } from "../../domain/midi/voiceCorrespondence";
import {
  derivePresentationKeys,
  deriveVoiceOrderPresentationKeys,
  IDENTITY_PRESENTATION_KEYS,
} from "./presentationKeys";

function correspondence(overrides: Partial<VoiceCorrespondence> = {}): VoiceCorrespondence {
  return {
    matched: [],
    unmatchedA: [],
    unmatchedB: [],
    ambiguous: [],
    splits: [],
    merges: [],
    matcherVersion: 1,
    ...overrides,
  };
}

describe("derivePresentationKeys", () => {
  it("maps visible voice order to the same slots used by number keys", () => {
    const keys = deriveVoiceOrderPresentationKeys(["voice-7", "voice-3", "percussion"]);

    expect(keys.get("voice-7")).toBe("voice-1");
    expect(keys.get("voice-3")).toBe("voice-2");
    expect(keys.get("percussion")).toBe("voice-3");
  });

  it("keeps every A voice on its own key", () => {
    const keys = derivePresentationKeys(
      correspondence({ matched: [{ aVoiceId: "voice-1", bVoiceId: "voice-9", overlap: 3 }] }),
    );
    expect(keys.keyForSide("A", "voice-1")).toBe("voice-1");
    expect(keys.keyForSide("A", "voice-2")).toBe("voice-2");
  });

  it("gives a matched B voice its A partner's key", () => {
    const keys = derivePresentationKeys(
      correspondence({
        matched: [
          { aVoiceId: "voice-1", bVoiceId: "voice-9", overlap: 3 },
          { aVoiceId: "voice-2", bVoiceId: "voice-7", overlap: 2 },
        ],
      }),
    );
    expect(keys.keyForSide("B", "voice-9")).toBe("voice-1");
    expect(keys.keyForSide("B", "voice-7")).toBe("voice-2");
  });

  it("keeps an unmatched B voice on its own key", () => {
    const keys = derivePresentationKeys(correspondence({ unmatchedB: ["voice-8"] }));
    expect(keys.keyForSide("B", "voice-8")).toBe("voice-8");
  });

  it("can map a read-only reference pane onto a current editable palette", () => {
    const keys = derivePresentationKeys(
      correspondence({
        matched: [{ aVoiceId: "voice-current", bVoiceId: "reference-lead", overlap: 2 }],
      }),
      { canonical: "A", matched: "reference" },
    );

    expect(keys.keyForSide("reference", "reference-lead")).toBe("voice-current");
    expect(keys.keyForSide("reference", "reference-only")).toBe("reference-only");
    expect(keys.keyForSide("other", "voice-current")).toBe("voice-current");
  });

  it("keeps percussion on its semantic key via its self-match", () => {
    const keys = derivePresentationKeys(
      correspondence({
        matched: [{ aVoiceId: "percussion", bVoiceId: "percussion", overlap: 4 }],
      }),
    );
    expect(keys.keyForSide("B", "percussion")).toBe("percussion");
  });

  it("identity map returns the voice id for either side", () => {
    expect(IDENTITY_PRESENTATION_KEYS.keyForSide("A", "voice-1")).toBe("voice-1");
    expect(IDENTITY_PRESENTATION_KEYS.keyForSide("B", "voice-9")).toBe("voice-9");
  });
});
