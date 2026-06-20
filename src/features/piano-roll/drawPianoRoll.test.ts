import { describe, expect, it } from "vitest";
import type { MidiNote } from "../../domain/midi/midiProject";
import {
  getVoiceFillColor,
  getVoiceStrokeColor,
  resolveNoteRenderStyle,
  type NoteRenderContext,
} from "./drawPianoRoll";

describe("voice colors", () => {
  it("maps voice IDs to stable palette colors", () => {
    expect(getVoiceFillColor("voice-1")).toBe("#38bdf8");
    expect(getVoiceFillColor("voice-2")).toBe("#a78bfa");
    expect(getVoiceStrokeColor("voice-1")).toBe("#7dd3fc");
  });

  it("wraps voice colors deterministically", () => {
    expect(getVoiceFillColor("voice-13")).toBe("#38bdf8");
  });

  it("gives the first 12 voices distinct fill colors", () => {
    const colors = Array.from({ length: 12 }, (_, index) =>
      getVoiceFillColor(`voice-${index + 1}`),
    );
    expect(new Set(colors).size).toBe(12);
  });
});

function note(overrides: Partial<MidiNote> = {}): MidiNote {
  return {
    id: "a",
    voiceId: "voice-1",
    sourceTrackIndex: 0,
    channel: 0,
    pitch: 60,
    velocity: 100,
    startTick: 0,
    endTick: 120,
    durationTicks: 120,
    assignmentConfidence: 1,
    assignmentReason: "IMPORTED",
    ...overrides,
  };
}

function context(overrides: Partial<NoteRenderContext> = {}): NoteRenderContext {
  return {
    selectedNoteIds: new Set(),
    soloVoiceId: null,
    paintPreview: new Map(),
    ...overrides,
  };
}

describe("resolveNoteRenderStyle", () => {
  it("uses the note's own voice color when unselected and not painted", () => {
    const style = resolveNoteRenderStyle(note({ voiceId: "voice-2" }), context());

    expect(style.fillColor).toBe(getVoiceFillColor("voice-2"));
    expect(style.strokeColor).toBe(getVoiceStrokeColor("voice-2"));
    expect(style.isSelected).toBe(false);
    expect(style.isDimmed).toBe(false);
  });

  it("uses a white stroke and marks selected when the note id is selected", () => {
    const style = resolveNoteRenderStyle(
      note({ id: "a", voiceId: "voice-2" }),
      context({ selectedNoteIds: new Set(["a"]) }),
    );

    expect(style.isSelected).toBe(true);
    expect(style.strokeColor).toBe("#f8fafc");
    expect(style.fillColor).toBe(getVoiceFillColor("voice-2"));
  });

  it("overrides the rendered voice color with the paint preview", () => {
    const style = resolveNoteRenderStyle(
      note({ id: "a", voiceId: "voice-1" }),
      context({ paintPreview: new Map([["a", "voice-3"]]) }),
    );

    expect(style.fillColor).toBe(getVoiceFillColor("voice-3"));
    expect(style.strokeColor).toBe(getVoiceStrokeColor("voice-3"));
  });

  it("dims a note whose effective voice does not match the soloed voice", () => {
    const style = resolveNoteRenderStyle(
      note({ voiceId: "voice-1" }),
      context({ soloVoiceId: "voice-2" }),
    );

    expect(style.isDimmed).toBe(true);
  });

  it("dims based on the paint-previewed voice, not the note's real voice", () => {
    const style = resolveNoteRenderStyle(
      note({ id: "a", voiceId: "voice-1" }),
      context({ soloVoiceId: "voice-1", paintPreview: new Map([["a", "voice-2"]]) }),
    );

    expect(style.isDimmed).toBe(true);
  });

  it("does not dim a note matching the soloed voice", () => {
    const style = resolveNoteRenderStyle(
      note({ voiceId: "voice-2" }),
      context({ soloVoiceId: "voice-2" }),
    );

    expect(style.isDimmed).toBe(false);
  });

  it("flags a note below the low-confidence threshold", () => {
    const style = resolveNoteRenderStyle(note({ assignmentConfidence: 0.2 }), context());

    expect(style.isLowConfidence).toBe(true);
  });

  it("does not flag a note at or above the low-confidence threshold", () => {
    const style = resolveNoteRenderStyle(note({ assignmentConfidence: 0.5 }), context());

    expect(style.isLowConfidence).toBe(false);
  });
});
