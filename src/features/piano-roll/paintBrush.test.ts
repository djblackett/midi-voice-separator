import { describe, expect, it } from "vitest";
import type { MidiProject } from "../../domain/midi/midiProject";
import type { PianoRollViewport } from "../../domain/midi/viewport";
import {
  clampBrushRadius,
  MAX_BRUSH_RADIUS,
  MIN_BRUSH_RADIUS,
  notesInBrushStamp,
  notesInLassoPath,
  pointInPolygon,
  stepBrushRadius,
} from "./paintBrush";

// Same fixture geometry as hitTest.test.ts: 1000px roll after the 56px
// label gutter, 5 pitch rows of 52px each.
// "long":  x 56..856,  y 209..259 (pitch 60, bottom row)
// "short": x 156..256, y 1..51    (pitch 64, top row)
const viewport: PianoRollViewport = {
  width: 1056,
  height: 260,
  startTick: 0,
  endTick: 1000,
  lowestPitch: 60,
  highestPitch: 64,
};

const project: MidiProject = {
  fileName: "test.mid",
  format: "single-track",
  ppq: 480,
  durationTicks: 1000,
  trackCount: 1,
  voices: [{ id: "voice-1", label: "Voice 1", noteCount: 2, lowestPitch: 60, highestPitch: 64 }],
  notes: [
    {
      id: "long",
      voiceId: "voice-1",
      sourceTrackIndex: 0,
      channel: 0,
      pitch: 60,
      velocity: 80,
      startTick: 0,
      endTick: 800,
      durationTicks: 800,
      assignmentConfidence: 1,
      assignmentReason: "IMPORTED",
    },
    {
      id: "short",
      voiceId: "voice-1",
      sourceTrackIndex: 0,
      channel: 0,
      pitch: 64,
      velocity: 90,
      startTick: 100,
      endTick: 200,
      durationTicks: 100,
      assignmentConfidence: 1,
      assignmentReason: "IMPORTED",
    },
  ],
  tempoChanges: [],
  timeSignatures: [],
  warnings: [],
  separationSummary: { meanConfidence: 1, lowConfidenceNoteCount: 0, voiceCount: 1 },
  strategySuggestion: { strategy: "BALANCED", reason: "test fixture" },
};

describe("clampBrushRadius", () => {
  it("rounds and clamps into the allowed range", () => {
    expect(clampBrushRadius(17.4)).toBe(17);
    expect(clampBrushRadius(0)).toBe(MIN_BRUSH_RADIUS);
    expect(clampBrushRadius(500)).toBe(MAX_BRUSH_RADIUS);
  });
});

describe("stepBrushRadius", () => {
  it("grows and shrinks multiplicatively", () => {
    expect(stepBrushRadius(20, 1)).toBe(23);
    expect(stepBrushRadius(23, -1)).toBe(20);
  });

  it("always moves at least 1px so small radii don't stick on rounding", () => {
    expect(stepBrushRadius(MIN_BRUSH_RADIUS, 1)).toBeGreaterThan(MIN_BRUSH_RADIUS);
  });

  it("clamps at both ends of the range", () => {
    expect(stepBrushRadius(MAX_BRUSH_RADIUS, 1)).toBe(MAX_BRUSH_RADIUS);
    expect(stepBrushRadius(MIN_BRUSH_RADIUS, -1)).toBe(MIN_BRUSH_RADIUS);
  });
});

describe("notesInBrushStamp", () => {
  it("hits a note under a stationary click stamp", () => {
    const hits = notesInBrushStamp({ x: 206, y: 26 }, { x: 206, y: 26 }, 10, project, viewport);
    expect(hits.map((note) => note.id)).toEqual(["short"]);
  });

  it("misses a note farther away than the radius, then hits it with a bigger brush", () => {
    const point = { x: 206, y: 90 }; // 39px below "short"'s bottom edge
    expect(notesInBrushStamp(point, point, 10, project, viewport)).toEqual([]);
    expect(notesInBrushStamp(point, point, 45, project, viewport).map((n) => n.id)).toEqual([
      "short",
    ]);
  });

  it("hits every note along a swept stroke segment, not just at the endpoints", () => {
    // Vertical sweep at x=206 crosses "short" (y 1..51) mid-segment and
    // ends inside "long" (y 209..259).
    const hits = notesInBrushStamp({ x: 206, y: 26 }, { x: 206, y: 240 }, 4, project, viewport);
    expect(hits.map((note) => note.id).sort()).toEqual(["long", "short"]);
  });

  it("hits a note the segment passes through even when both endpoints are outside it", () => {
    const hits = notesInBrushStamp({ x: 100, y: 26 }, { x: 300, y: 26 }, 4, project, viewport);
    expect(hits.map((note) => note.id)).toEqual(["short"]);
  });

  it("ignores notes scrolled entirely behind the label gutter", () => {
    const scrolled: PianoRollViewport = { ...viewport, startTick: 900, endTick: 1000 };
    expect(notesInBrushStamp({ x: 60, y: 130 }, { x: 60, y: 130 }, 60, project, scrolled)).toEqual(
      [],
    );
  });

  it("returns nothing without a project", () => {
    expect(notesInBrushStamp({ x: 206, y: 26 }, { x: 206, y: 26 }, 10, null, viewport)).toEqual([]);
  });
});

describe("pointInPolygon", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it("detects containment", () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false);
  });
});

describe("notesInLassoPath", () => {
  it("returns nothing for a degenerate path", () => {
    expect(
      notesInLassoPath(
        [
          { x: 0, y: 0 },
          { x: 100, y: 100 },
        ],
        project,
        viewport,
      ),
    ).toEqual([]);
  });

  it("captures a note fully enclosed by the loop", () => {
    const loop = [
      { x: 140, y: -5 },
      { x: 270, y: -5 },
      { x: 270, y: 60 },
      { x: 140, y: 60 },
    ];
    expect(notesInLassoPath(loop, project, viewport).map((note) => note.id)).toEqual(["short"]);
  });

  it("captures a note when the loop is drawn entirely inside it", () => {
    const loop = [
      { x: 400, y: 220 },
      { x: 450, y: 220 },
      { x: 425, y: 245 },
    ];
    expect(notesInLassoPath(loop, project, viewport).map((note) => note.id)).toEqual(["long"]);
  });

  it("captures nothing when the loop encloses empty space", () => {
    const loop = [
      { x: 500, y: 80 },
      { x: 600, y: 80 },
      { x: 550, y: 150 },
    ];
    expect(notesInLassoPath(loop, project, viewport)).toEqual([]);
  });
});
