import { describe, expect, it } from "vitest";
import { getVoiceFillColor, getVoiceStrokeColor } from "./drawPianoRoll";

describe("voice colors", () => {
  it("maps voice IDs to stable palette colors", () => {
    expect(getVoiceFillColor("voice-1")).toBe("#38bdf8");
    expect(getVoiceFillColor("voice-2")).toBe("#a78bfa");
    expect(getVoiceStrokeColor("voice-1")).toBe("#7dd3fc");
  });

  it("wraps voice colors deterministically", () => {
    expect(getVoiceFillColor("voice-7")).toBe("#38bdf8");
  });
});
