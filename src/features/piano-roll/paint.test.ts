import { describe, expect, it } from "vitest";
import { shouldPaintNote } from "./paint";

describe("shouldPaintNote", () => {
  it("paints a note already in a different voice", () => {
    expect(shouldPaintNote({ id: "a", voiceId: "voice-1" }, "voice-2", new Set())).toBe(true);
  });

  it("skips a note already in the active voice", () => {
    expect(shouldPaintNote({ id: "a", voiceId: "voice-2" }, "voice-2", new Set())).toBe(false);
  });

  it("skips a note already painted in this stroke", () => {
    expect(shouldPaintNote({ id: "a", voiceId: "voice-1" }, "voice-2", new Set(["a"]))).toBe(false);
  });
});
