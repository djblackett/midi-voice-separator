import { describe, expect, it } from "vitest";
import type { MidiNote, MidiProject } from "../../domain/midi/midiProject";
import type { PianoRollViewport } from "../../domain/midi/viewport";
import { createMockCanvasContext } from "./canvasTestContext";
import {
  confidenceHeatColor,
  drawPianoRoll,
  drawTimeRuler,
  drawVoiceLanes,
  getVoiceFillColor,
  getVoiceStrokeColor,
  PIANO_ROLL_LABEL_WIDTH,
  resolveNoteRenderStyle,
  type NoteRenderContext,
} from "./drawPianoRoll";
import {
  createVoiceLaneViewGeometry,
  PIANO_VIEW_GUTTER_WIDTH,
  type ViewGeometry,
} from "./viewGeometry";

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

  it("colors a note by its voice's presentation key when one is given (M10)", () => {
    // A B-side voice-9 matched to A's voice-2 renders in voice-2's color.
    const style = resolveNoteRenderStyle(
      note({ voiceId: "voice-9" }),
      context({ presentationKeyByVoiceId: new Map([["voice-9", "voice-2"]]) }),
    );

    expect(style.fillColor).toBe(getVoiceFillColor("voice-2"));
    expect(style.strokeColor).toBe(getVoiceStrokeColor("voice-2"));
  });

  it("falls back to the voice's own color for an unmapped voice", () => {
    const style = resolveNoteRenderStyle(
      note({ voiceId: "voice-4" }),
      context({ presentationKeyByVoiceId: new Map([["voice-9", "voice-2"]]) }),
    );

    expect(style.fillColor).toBe(getVoiceFillColor("voice-4"));
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

  it("shows the conflict underline as an independent cue", () => {
    const style = resolveNoteRenderStyle(
      note({ id: "a", assignmentConfidence: 0.2 }),
      context({
        changedNoteIds: new Set(["a"]),
        conflictNoteIds: new Set(["a"]),
        selectedNoteIds: new Set(["a"]),
      }),
    );

    expect(style.showConflictUnderline).toBe(true);
    expect(style.showChangedEdge).toBe(false);
    expect(style.showLowConfidenceDash).toBe(false);
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

const viewport: PianoRollViewport = {
  width: 856,
  height: 260,
  startTick: 0,
  endTick: 960,
  lowestPitch: 60,
  highestPitch: 64,
};

function project(overrides: Partial<MidiProject> = {}): MidiProject {
  return {
    fileName: "test.mid",
    format: "single-track",
    ppq: 480,
    durationTicks: 960,
    trackCount: 1,
    voices: [{ id: "voice-1", label: "Voice 1", noteCount: 1, lowestPitch: 60, highestPitch: 64 }],
    notes: [note()],
    tempoChanges: [],
    timeSignatures: [],
    warnings: [],
    separationSummary: { meanConfidence: 1, lowConfidenceNoteCount: 0, voiceCount: 1 },
    strategySuggestion: { strategy: "BALANCED", reason: "test fixture" },
    ...overrides,
  };
}

interface DrawVoiceLaneArgs {
  geometry?: ViewGeometry;
  marqueeRect?: Parameters<typeof drawVoiceLanes>[5];
  soloVoiceId?: string | null;
  playheadTick?: number | null;
}

function callDrawVoiceLanes(
  context: CanvasRenderingContext2D,
  midiProject: MidiProject | null,
  args: DrawVoiceLaneArgs = {},
  drawViewport: PianoRollViewport = viewport,
): void {
  drawVoiceLanes(
    context,
    midiProject,
    drawViewport,
    args.geometry ?? createVoiceLaneViewGeometry(midiProject, drawViewport),
    undefined,
    args.marqueeRect ?? null,
    args.soloVoiceId,
    undefined,
    args.playheadTick,
  );
}

interface DrawPianoRollArgs {
  selectedNoteIds?: ReadonlySet<string>;
  marqueeRect?: Parameters<typeof drawPianoRoll>[4];
  soloVoiceId?: string | null;
  paintPreview?: ReadonlyMap<string, string>;
  pitchMarkers?: Parameters<typeof drawPianoRoll>[7];
  playheadTick?: number | null;
  changedNoteIds?: ReadonlySet<string>;
  previousVoiceId?: ReadonlyMap<string, string>;
  onlyChangedNotes?: boolean;
  confidenceHeatmap?: boolean;
  conflictNoteIds?: ReadonlySet<string>;
  timeRangeSelection?: Parameters<typeof drawPianoRoll>[14];
}

function callDrawPianoRoll(
  context: CanvasRenderingContext2D,
  midiProject: MidiProject | null,
  args: DrawPianoRollArgs = {},
  drawViewport: PianoRollViewport = viewport,
): void {
  drawPianoRoll(
    context,
    midiProject,
    drawViewport,
    args.selectedNoteIds,
    args.marqueeRect ?? null,
    args.soloVoiceId ?? null,
    args.paintPreview,
    args.pitchMarkers,
    args.playheadTick ?? null,
    args.changedNoteIds,
    args.previousVoiceId,
    args.onlyChangedNotes,
    args.confidenceHeatmap,
    args.conflictNoteIds,
    args.timeRangeSelection ?? null,
  );
}

describe("drawPianoRoll", () => {
  it("keeps the legacy label width as an alias of the canonical piano gutter", () => {
    expect(PIANO_ROLL_LABEL_WIDTH).toBe(PIANO_VIEW_GUTTER_WIDTH);
  });

  it("clears and fills the background", () => {
    const context = createMockCanvasContext();

    callDrawPianoRoll(context, project());

    expect(context.clearRect).toHaveBeenCalledWith(0, 0, viewport.width, viewport.height);
  });

  it("shows a placeholder and draws no notes when there is no project", () => {
    const context = createMockCanvasContext();

    callDrawPianoRoll(context, null);

    expect(
      context.styledCalls.some(
        (call) => call.method === "fillText" && call.args[0] === "No notes loaded",
      ),
    ).toBe(true);
    expect(context.strokeRect).not.toHaveBeenCalled();
  });

  it("shows a placeholder when the project has no notes", () => {
    const context = createMockCanvasContext();

    callDrawPianoRoll(context, project({ notes: [] }));

    expect(
      context.styledCalls.some(
        (call) => call.method === "fillText" && call.args[0] === "No notes loaded",
      ),
    ).toBe(true);
  });

  it("draws exactly one strokeRect for a single visible note", () => {
    const context = createMockCanvasContext();

    callDrawPianoRoll(context, project());

    expect(context.strokeRect).toHaveBeenCalledTimes(1);
  });

  it("clips a partial note and its cues to the gutter and skips a fully hidden note", () => {
    const context = createMockCanvasContext();
    const partial = note({
      id: "partial",
      pitch: 64,
      startTick: 0,
      endTick: 100,
      durationTicks: 100,
    });
    const hidden = note({
      id: "hidden",
      pitch: 64,
      startTick: 0,
      endTick: 40,
      durationTicks: 40,
    });
    const scrolledViewport = { ...viewport, startTick: 50, endTick: 150 };

    callDrawPianoRoll(
      context,
      project({ notes: [partial, hidden] }),
      {
        changedNoteIds: new Set([partial.id]),
        conflictNoteIds: new Set([partial.id]),
      },
      scrolledViewport,
    );

    expect(context.rect).toHaveBeenCalledWith(
      PIANO_VIEW_GUTTER_WIDTH,
      0,
      viewport.width - PIANO_VIEW_GUTTER_WIDTH,
      viewport.height,
    );
    expect(context.clip).toHaveBeenCalledTimes(1);
    expect(context.strokeRect).toHaveBeenCalledTimes(1);
    expect(context.strokeRect).toHaveBeenCalledWith(PIANO_VIEW_GUTTER_WIDTH, 1, 400, 50);
    expect(
      context.styledCalls.find((call) => call.method === "fillRect" && call.fillStyle === "#facc15")
        ?.args,
    ).toEqual([PIANO_VIEW_GUTTER_WIDTH, 1, 3, 50]);
    expect(
      context.styledCalls.find((call) => call.method === "fillRect" && call.fillStyle === "#ef4444")
        ?.args,
    ).toEqual([PIANO_VIEW_GUTTER_WIDTH, 49, 400, 2]);
  });

  it("fills a note in its voice color at full opacity when not dimmed", () => {
    const context = createMockCanvasContext();

    callDrawPianoRoll(context, project());

    const noteFill = context.styledCalls.find(
      (call) => call.method === "fillRect" && call.fillStyle === getVoiceFillColor("voice-1"),
    );
    expect(noteFill?.globalAlpha).toBe(1);
  });

  it("gives a selected note a thicker white stroke", () => {
    const context = createMockCanvasContext();

    callDrawPianoRoll(context, project(), { selectedNoteIds: new Set(["a"]) });

    const strokeCall = context.styledCalls.find((call) => call.method === "strokeRect");
    expect(strokeCall?.lineWidth).toBe(3);
    expect(strokeCall?.strokeStyle).toBe("#f8fafc");
  });

  it("dims a note whose voice does not match the soloed voice", () => {
    const context = createMockCanvasContext();

    callDrawPianoRoll(context, project(), { soloVoiceId: "voice-2" });

    const noteFill = context.styledCalls.find(
      (call) => call.method === "fillRect" && call.fillStyle === getVoiceFillColor("voice-1"),
    );
    expect(noteFill?.globalAlpha).toBe(0.25);
  });

  it("dashes and then resets the stroke for a low-confidence note", () => {
    const context = createMockCanvasContext();

    callDrawPianoRoll(context, project({ notes: [note({ assignmentConfidence: 0.1 })] }));

    expect(context.setLineDash).toHaveBeenCalledWith([3, 2]);
    expect(context.setLineDash).toHaveBeenLastCalledWith([]);
  });

  it("draws an extra edge-marker fillRect for a changed note", () => {
    const context = createMockCanvasContext();

    callDrawPianoRoll(context, project(), { changedNoteIds: new Set(["a"]) });

    const edgeMarker = context.styledCalls.find(
      (call) => call.method === "fillRect" && call.fillStyle === "#facc15",
    );
    expect(edgeMarker).toBeDefined();
  });

  it("uses the previous voice's color for the changed-note edge marker when known", () => {
    const context = createMockCanvasContext();

    callDrawPianoRoll(context, project(), {
      changedNoteIds: new Set(["a"]),
      previousVoiceId: new Map([["a", "voice-3"]]),
    });

    const edgeMarker = context.styledCalls.find(
      (call) => call.method === "fillRect" && call.fillStyle === getVoiceFillColor("voice-3"),
    );
    expect(edgeMarker).toBeDefined();
  });

  it("draws an extra underline fillRect for a conflicting note", () => {
    const context = createMockCanvasContext();

    callDrawPianoRoll(context, project(), { conflictNoteIds: new Set(["a"]) });

    const underline = context.styledCalls.find(
      (call) => call.method === "fillRect" && call.fillStyle === "#ef4444",
    );
    expect(underline).toBeDefined();
  });

  it("draws the marquee overlay only when a marqueeRect is given", () => {
    const withoutMarquee = createMockCanvasContext();
    callDrawPianoRoll(withoutMarquee, project());
    expect(
      withoutMarquee.styledCalls.some(
        (call) => call.method === "fillRect" && call.fillStyle === "rgba(56, 189, 248, 0.15)",
      ),
    ).toBe(false);

    const withMarquee = createMockCanvasContext();
    callDrawPianoRoll(withMarquee, project(), {
      marqueeRect: { x0: 100, y0: 0, x1: 200, y1: 100 },
    });
    expect(
      withMarquee.styledCalls.some(
        (call) => call.method === "fillRect" && call.fillStyle === "rgba(56, 189, 248, 0.15)",
      ),
    ).toBe(true);
  });

  it("highlights the selected time range when given", () => {
    const context = createMockCanvasContext();

    callDrawPianoRoll(context, project(), {
      timeRangeSelection: { startTick: 0, endTick: 480 },
    });

    expect(
      context.styledCalls.some(
        (call) => call.method === "fillRect" && call.fillStyle === "rgba(56, 189, 248, 0.18)",
      ),
    ).toBe(true);
  });

  it("only draws notes in changedNoteIds when onlyChangedNotes is set", () => {
    const context = createMockCanvasContext();
    const notes = [note({ id: "a" }), note({ id: "b", startTick: 200, endTick: 300 })];

    callDrawPianoRoll(context, project({ notes }), {
      changedNoteIds: new Set(["a"]),
      onlyChangedNotes: true,
    });

    expect(context.strokeRect).toHaveBeenCalledTimes(1);
  });

  it("draws a playhead line only when the tick is within the visible window", () => {
    const inRange = createMockCanvasContext();
    callDrawPianoRoll(inRange, project(), { playheadTick: 100 });
    expect(
      inRange.styledCalls.some((call) => call.method === "stroke" && call.lineWidth === 2),
    ).toBe(true);

    const outOfRange = createMockCanvasContext();
    callDrawPianoRoll(outOfRange, project(), { playheadTick: 5000 });
    expect(
      outOfRange.styledCalls.some((call) => call.method === "stroke" && call.lineWidth === 2),
    ).toBe(false);
  });

  it("draws a pitch marker within the visible pitch range, with its label", () => {
    const context = createMockCanvasContext();

    callDrawPianoRoll(context, project(), {
      pitchMarkers: [{ id: "m1", label: "Melody floor", pitch: 62 }],
    });

    expect(
      context.styledCalls.some(
        (call) => call.method === "fillText" && call.args[0] === "Melody floor: 62",
      ),
    ).toBe(true);
  });

  it("skips a pitch marker outside the visible pitch range", () => {
    const context = createMockCanvasContext();

    callDrawPianoRoll(context, project(), {
      pitchMarkers: [{ id: "m1", label: "Out of view", pitch: 20 }],
    });

    expect(
      context.styledCalls.some(
        (call) => call.method === "fillText" && String(call.args[0]).startsWith("Out of view"),
      ),
    ).toBe(false);
  });
});

describe("drawTimeRuler", () => {
  const rulerViewport: PianoRollViewport = { ...viewport, height: 20 };

  it("clears and fills the ruler background", () => {
    const context = createMockCanvasContext();

    drawTimeRuler(context, rulerViewport, 480);

    expect(context.clearRect).toHaveBeenCalledWith(0, 0, rulerViewport.width, 20);
  });

  it("uses the canonical piano gutter by default and accepts a bound view gutter", () => {
    const piano = createMockCanvasContext();
    drawTimeRuler(piano, rulerViewport, 480);
    expect(
      piano.styledCalls.find((call) => call.method === "fillRect" && call.fillStyle === "#111827")
        ?.args,
    ).toEqual([PIANO_VIEW_GUTTER_WIDTH, 0, 800, 20]);

    const alternate = createMockCanvasContext();
    drawTimeRuler(alternate, rulerViewport, 480, null, null, 96);
    expect(
      alternate.styledCalls.find(
        (call) => call.method === "fillRect" && call.fillStyle === "#111827",
      )?.args,
    ).toEqual([96, 0, 760, 20]);
  });

  it("draws a playhead tick only when within the visible window", () => {
    const inRange = createMockCanvasContext();
    drawTimeRuler(inRange, rulerViewport, 480, 100);
    expect(
      inRange.styledCalls.some((call) => call.method === "stroke" && call.lineWidth === 2),
    ).toBe(true);

    const outOfRange = createMockCanvasContext();
    drawTimeRuler(outOfRange, rulerViewport, 480, 5000);
    expect(
      outOfRange.styledCalls.some((call) => call.method === "stroke" && call.lineWidth === 2),
    ).toBe(false);
  });

  it("highlights the selected time range when given", () => {
    const context = createMockCanvasContext();

    drawTimeRuler(context, rulerViewport, 480, null, { startTick: 0, endTick: 480 });

    expect(
      context.styledCalls.some(
        (call) => call.method === "fillRect" && call.fillStyle === "rgba(56, 189, 248, 0.28)",
      ),
    ).toBe(true);
  });
});

describe("drawVoiceLanes", () => {
  it("shows a placeholder and draws no notes when the project has no notes", () => {
    const context = createMockCanvasContext();

    callDrawVoiceLanes(context, project({ notes: [] }));

    expect(
      context.styledCalls.some(
        (call) => call.method === "fillText" && call.args[0] === "No notes loaded",
      ),
    ).toBe(true);
    expect(context.strokeRect).not.toHaveBeenCalled();
  });

  it("draws one strokeRect per visible note across its voice's lane", () => {
    const context = createMockCanvasContext();

    callDrawVoiceLanes(context, project());

    expect(context.strokeRect).toHaveBeenCalledTimes(1);
  });

  it("draws only canonical visible rows and notes after lane scrolling", () => {
    const context = createMockCanvasContext();
    const voices = Array.from({ length: 5 }, (_, index) => ({
      id: `voice-${index + 1}`,
      label: `Voice ${index + 1}`,
      noteCount: 1,
      lowestPitch: 60,
      highestPitch: 60,
    }));
    const notes = voices.map((candidate, index) =>
      note({ id: `note-${index + 1}`, voiceId: candidate.id }),
    );
    const midiProject = project({ voices, notes });
    const drawViewport = { ...viewport, height: 72 };
    const geometry = createVoiceLaneViewGeometry(midiProject, drawViewport, {
      laneHeight: 36,
      scrollTopPx: 36,
    });

    callDrawVoiceLanes(context, midiProject, { geometry }, drawViewport);

    const labels = context.styledCalls
      .filter((call) => call.method === "fillText")
      .map((call) => call.args[0]);
    expect(labels).toEqual(["Voice 2", "Voice 3"]);
    expect(context.strokeRect).toHaveBeenCalledTimes(2);
    const visibleRect = geometry.noteRect(notes[1]);
    expect(visibleRect).not.toBeNull();
    expect(context.strokeRect).toHaveBeenCalledWith(
      visibleRect?.left,
      visibleRect?.top,
      (visibleRect?.right ?? 0) - (visibleRect?.left ?? 0),
      (visibleRect?.bottom ?? 0) - (visibleRect?.top ?? 0),
    );
    expect(
      context.styledCalls.some(
        (call) =>
          call.method === "fillRect" &&
          call.args[0] === geometry.gutterWidth &&
          call.args[1] === 0 &&
          call.fillStyle === "#0f172a",
      ),
    ).toBe(true);
  });

  it("skips a note whose voice has no matching lane", () => {
    const context = createMockCanvasContext();

    callDrawVoiceLanes(context, project({ notes: [note({ voiceId: "voice-missing" })] }));

    expect(context.strokeRect).not.toHaveBeenCalled();
  });

  it("dims a note whose voice does not match the soloed voice", () => {
    const context = createMockCanvasContext();

    callDrawVoiceLanes(context, project(), { soloVoiceId: "voice-2" });

    const noteFill = context.styledCalls.find(
      (call) => call.method === "fillRect" && call.fillStyle === getVoiceFillColor("voice-1"),
    );
    expect(noteFill?.globalAlpha).toBe(0.25);
  });

  it("draws a playhead line only when the tick is within the visible window", () => {
    const inRange = createMockCanvasContext();
    callDrawVoiceLanes(inRange, project(), { playheadTick: 100 });
    expect(
      inRange.styledCalls.some((call) => call.method === "stroke" && call.lineWidth === 2),
    ).toBe(true);

    const outOfRange = createMockCanvasContext();
    callDrawVoiceLanes(outOfRange, project(), { playheadTick: 5000 });
    expect(
      outOfRange.styledCalls.some((call) => call.method === "stroke" && call.lineWidth === 2),
    ).toBe(false);
  });

  it("draws a normalized marquee overlay when a marqueeRect is given", () => {
    const context = createMockCanvasContext();

    callDrawVoiceLanes(context, project(), {
      marqueeRect: { x0: 160, y0: 80, x1: 110, y1: 40 },
    });

    expect(
      context.styledCalls.find(
        (call) => call.method === "fillRect" && call.fillStyle === "rgba(56, 189, 248, 0.15)",
      ),
    ).toMatchObject({ args: [110, 40, 50, 40] });
    expect(
      context.styledCalls.find(
        (call) => call.method === "strokeRect" && call.strokeStyle === "#38bdf8",
      ),
    ).toMatchObject({ args: [110, 40, 50, 40], lineWidth: 1 });
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
