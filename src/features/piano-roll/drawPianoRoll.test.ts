import { describe, expect, it } from "vitest";
import type { MidiNote } from "../../domain/midi/midiProject";
import {
  confidenceHeatColor,
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
    changedNoteIds: new Set(),
    previousVoiceId: new Map(),
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

  it("flags a note in changedNoteIds as changed", () => {
    const style = resolveNoteRenderStyle(
      note({ id: "a" }),
      context({ changedNoteIds: new Set(["a"]) }),
    );

    expect(style.isChanged).toBe(true);
  });

  it("resolves the changed-edge color from the previous voice", () => {
    const style = resolveNoteRenderStyle(
      note({ id: "a" }),
      context({
        changedNoteIds: new Set(["a"]),
        previousVoiceId: new Map([["a", "voice-3"]]),
      }),
    );

    expect(style.changeEdgeColor).toBe(getVoiceFillColor("voice-3"));
  });

  it("has a null changed-edge color when the previous voice is unknown", () => {
    const style = resolveNoteRenderStyle(
      note({ id: "a" }),
      context({ changedNoteIds: new Set(["a"]) }),
    );

    expect(style.showChangedEdge).toBe(true);
    expect(style.changeEdgeColor).toBeNull();
  });

  it("does not compute a changed-edge color for an unchanged note even with a previousVoiceId entry", () => {
    const style = resolveNoteRenderStyle(
      note({ id: "a" }),
      context({ previousVoiceId: new Map([["a", "voice-3"]]) }),
    );

    expect(style.isChanged).toBe(false);
    expect(style.showChangedEdge).toBe(false);
    expect(style.changeEdgeColor).toBeNull();
  });

  it("shows the changed edge cue independently of the paint-preview color (independent channels)", () => {
    const style = resolveNoteRenderStyle(
      note({ id: "a", voiceId: "voice-1" }),
      context({
        changedNoteIds: new Set(["a"]),
        paintPreview: new Map([["a", "voice-2"]]),
      }),
    );

    expect(style.showChangedEdge).toBe(true);
    expect(style.fillColor).toBe(getVoiceFillColor("voice-2"));
  });

  describe("cue precedence (selection > changed edge > low-confidence dash)", () => {
    // Full truth table over the three border-competing cues. Solo dimming
    // and paint-preview color are independent channels and are not part of
    // this matrix (see the dedicated tests above/below).
    const cases: Array<{
      isSelected: boolean;
      isChanged: boolean;
      isLowConfidence: boolean;
      expectShowChangedEdge: boolean;
      expectShowLowConfidenceDash: boolean;
    }> = [
      {
        isSelected: false,
        isChanged: false,
        isLowConfidence: false,
        expectShowChangedEdge: false,
        expectShowLowConfidenceDash: false,
      },
      {
        isSelected: false,
        isChanged: false,
        isLowConfidence: true,
        expectShowChangedEdge: false,
        expectShowLowConfidenceDash: true,
      },
      {
        isSelected: false,
        isChanged: true,
        isLowConfidence: false,
        expectShowChangedEdge: true,
        expectShowLowConfidenceDash: false,
      },
      {
        isSelected: false,
        isChanged: true,
        isLowConfidence: true,
        expectShowChangedEdge: true,
        expectShowLowConfidenceDash: false,
      },
      {
        isSelected: true,
        isChanged: false,
        isLowConfidence: false,
        expectShowChangedEdge: false,
        expectShowLowConfidenceDash: false,
      },
      {
        isSelected: true,
        isChanged: false,
        isLowConfidence: true,
        expectShowChangedEdge: false,
        expectShowLowConfidenceDash: false,
      },
      {
        isSelected: true,
        isChanged: true,
        isLowConfidence: false,
        expectShowChangedEdge: false,
        expectShowLowConfidenceDash: false,
      },
      {
        isSelected: true,
        isChanged: true,
        isLowConfidence: true,
        expectShowChangedEdge: false,
        expectShowLowConfidenceDash: false,
      },
    ];

    for (const testCase of cases) {
      const label = `selected=${testCase.isSelected} changed=${testCase.isChanged} lowConfidence=${testCase.isLowConfidence}`;
      it(`${label} -> changedEdge=${testCase.expectShowChangedEdge} lowConfidenceDash=${testCase.expectShowLowConfidenceDash}`, () => {
        const style = resolveNoteRenderStyle(
          note({ id: "a", assignmentConfidence: testCase.isLowConfidence ? 0.2 : 1 }),
          context({
            selectedNoteIds: testCase.isSelected ? new Set(["a"]) : new Set(),
            changedNoteIds: testCase.isChanged ? new Set(["a"]) : new Set(),
          }),
        );

        expect(style.showChangedEdge).toBe(testCase.expectShowChangedEdge);
        expect(style.showLowConfidenceDash).toBe(testCase.expectShowLowConfidenceDash);
      });
    }
  });
});

describe("confidence heat colors", () => {
  it("sweeps hue from red (0) to green (1)", () => {
    expect(confidenceHeatColor(0)).toBe("hsl(0, 85%, 55%)");
    expect(confidenceHeatColor(0.5)).toBe("hsl(70, 85%, 55%)");
    expect(confidenceHeatColor(1)).toBe("hsl(140, 85%, 55%)");
  });

  it("clamps out-of-range confidence", () => {
    expect(confidenceHeatColor(-1)).toBe(confidenceHeatColor(0));
    expect(confidenceHeatColor(2)).toBe(confidenceHeatColor(1));
  });
});

describe("resolveNoteRenderStyle with confidenceHeatmap", () => {
  it("fills by confidence heat instead of voice color", () => {
    const style = resolveNoteRenderStyle(
      note({ voiceId: "voice-2", assignmentConfidence: 0.2 }),
      context({ confidenceHeatmap: true }),
    );

    expect(style.fillColor).toBe(confidenceHeatColor(0.2));
    expect(style.fillColor).not.toBe(getVoiceFillColor("voice-2"));
  });

  it("lets an in-progress paint preview win over the heatmap", () => {
    const style = resolveNoteRenderStyle(
      note({ id: "a", voiceId: "voice-1", assignmentConfidence: 0.2 }),
      context({ confidenceHeatmap: true, paintPreview: new Map([["a", "voice-3"]]) }),
    );

    expect(style.fillColor).toBe(getVoiceFillColor("voice-3"));
  });

  it("keeps the white selection stroke in heat view", () => {
    const style = resolveNoteRenderStyle(
      note({ id: "a", assignmentConfidence: 0.2 }),
      context({ confidenceHeatmap: true, selectedNoteIds: new Set(["a"]) }),
    );

    expect(style.strokeColor).toBe("#f8fafc");
    expect(style.fillColor).toBe(confidenceHeatColor(0.2));
  });
});
