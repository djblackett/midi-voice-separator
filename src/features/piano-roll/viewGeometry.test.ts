import { describe, expect, it } from "vitest";
import type { MidiNote, MidiProject, MidiVoice } from "../../domain/midi/midiProject";
import type { PianoRollViewport } from "../../domain/midi/viewport";
import {
  createPianoViewGeometry,
  createVoiceLaneViewGeometry,
  hitTestNoteAtPoint,
  hitTestNotesInRect,
  notesInBrushStampForView,
  notesInLassoPathForView,
  PIANO_VIEW_CAPABILITIES,
  PIANO_VIEW_GUTTER_WIDTH,
  resolveViewCapabilities,
  VOICE_LANE_VIEW_CAPABILITIES,
  type ScreenRect,
  type ViewGeometry,
} from "./viewGeometry";
import { VOICE_LANE_LABEL_WIDTH } from "./voiceLanes";

function voice(overrides: Partial<MidiVoice> = {}): MidiVoice {
  return {
    id: "voice-1",
    label: "Lead",
    noteCount: 3,
    lowestPitch: 60,
    highestPitch: 64,
    ...overrides,
  };
}

function note(overrides: Partial<MidiNote> = {}): MidiNote {
  return {
    id: "note-1",
    voiceId: "voice-1",
    sourceTrackIndex: 0,
    channel: 0,
    pitch: 60,
    velocity: 96,
    startTick: 0,
    endTick: 100,
    durationTicks: 100,
    assignmentConfidence: 1,
    assignmentReason: "IMPORTED",
    ...overrides,
  };
}

const longNote = note({ id: "long", pitch: 60, startTick: 0, endTick: 800, durationTicks: 800 });
const shortNote = note({
  id: "short",
  pitch: 64,
  startTick: 100,
  endTick: 200,
  durationTicks: 100,
});
const zeroDurationNote = note({
  id: "zero-duration",
  pitch: 62,
  startTick: 500,
  endTick: 500,
  durationTicks: 0,
});
const highLaneNote = note({
  id: "high-lane",
  voiceId: "voice-2",
  pitch: 76,
  startTick: 120,
  endTick: 360,
  durationTicks: 240,
});
const orphanNote = note({ id: "orphan", voiceId: "missing-voice" });

const project: MidiProject = {
  fileName: "view-geometry.mid",
  format: "single-track",
  ppq: 480,
  durationTicks: 1000,
  trackCount: 1,
  voices: [
    voice(),
    voice({
      id: "voice-2",
      label: "High harmony",
      noteCount: 1,
      lowestPitch: 72,
      highestPitch: 76,
    }),
  ],
  notes: [longNote, shortNote, zeroDurationNote, highLaneNote],
  tempoChanges: [],
  timeSignatures: [],
  warnings: [],
  separationSummary: { meanConfidence: 1, lowConfidenceNoteCount: 0, voiceCount: 2 },
  strategySuggestion: { strategy: "BALANCED", reason: "test fixture" },
};

const pianoViewport: PianoRollViewport = {
  width: 1056,
  height: 260,
  startTick: 0,
  endTick: 1000,
  lowestPitch: 60,
  highestPitch: 64,
};

const laneViewport: PianoRollViewport = {
  width: 1096,
  height: 200,
  startTick: 0,
  endTick: 1000,
  lowestPitch: 60,
  highestPitch: 76,
};

function denseLaneProject(voiceCount = 6): MidiProject {
  const voices = Array.from({ length: voiceCount }, (_, index) =>
    voice({
      id: `voice-${index + 1}`,
      label: `Voice ${index + 1}`,
      noteCount: 1,
      lowestPitch: 60,
      highestPitch: 60,
    }),
  );
  const notes = voices.map((candidate, index) =>
    note({
      id: `dense-note-${index + 1}`,
      voiceId: candidate.id,
      pitch: 60,
      startTick: 100,
      endTick: 200,
      durationTicks: 100,
    }),
  );
  return {
    ...project,
    voices,
    notes,
    separationSummary: { ...project.separationSummary, voiceCount },
  };
}

const denseLaneViewport: PianoRollViewport = {
  ...laneViewport,
  height: 72,
  lowestPitch: 60,
  highestPitch: 60,
};

function geometryWithRects(
  rectForNote: (candidate: MidiNote) => ScreenRect | null,
  gutterWidth = 10,
): ViewGeometry {
  return {
    kind: "piano",
    gutterWidth,
    capabilities: PIANO_VIEW_CAPABILITIES,
    laneRows: null,
    noteRect: rectForNote,
    revealTarget: () => null,
  };
}

describe("view geometry adapters", () => {
  it("resolves the capability matrix from the view kind", () => {
    expect(resolveViewCapabilities("piano")).toBe(PIANO_VIEW_CAPABILITIES);
    expect(resolveViewCapabilities("voice-lanes")).toBe(VOICE_LANE_VIEW_CAPABILITIES);
  });

  it("binds piano metadata and target capabilities", () => {
    const geometry = createPianoViewGeometry(project, pianoViewport);

    expect(geometry.kind).toBe("piano");
    expect(geometry.gutterWidth).toBe(56);
    expect(geometry.laneRows).toBeNull();
    expect(geometry.capabilities).toEqual({
      clickSelection: true,
      marqueeSelection: true,
      contextActions: true,
      audition: true,
      pencil: true,
      brush: true,
      lasso: true,
      wand: true,
      pitchRangeMarkers: true,
      verticalAxis: "pitch",
    });
  });

  it("binds voice-lane rows in project order and target capabilities", () => {
    const geometry = createVoiceLaneViewGeometry(project, laneViewport);

    expect(geometry.kind).toBe("voice-lanes");
    expect(geometry.gutterWidth).toBe(96);
    expect(geometry.laneRows).toMatchObject([
      { rowIndex: 0, voiceId: "voice-1", y: 0, height: 100 },
      { rowIndex: 1, voiceId: "voice-2", y: 100, height: 100 },
    ]);
    expect(geometry.capabilities).toEqual({
      clickSelection: true,
      marqueeSelection: true,
      contextActions: true,
      audition: true,
      pencil: true,
      brush: true,
      lasso: true,
      wand: true,
      pitchRangeMarkers: false,
      verticalAxis: "lanes",
    });
  });

  it("exposes only rows intersecting a resolved scrolled viewport", () => {
    const denseProject = denseLaneProject();
    const geometry = createVoiceLaneViewGeometry(denseProject, denseLaneViewport, {
      laneHeight: 36,
      scrollTopPx: 36,
    });

    expect(geometry.laneRows).toMatchObject([
      { rowIndex: 1, voiceId: "voice-2", y: 0, height: 36 },
      { rowIndex: 2, voiceId: "voice-3", y: 36, height: 36 },
    ]);
    expect(geometry.noteRect(denseProject.notes[0])).toBeNull();
    expect(geometry.noteRect(denseProject.notes[1])?.top).toBe(6);
  });

  it("creates empty lane layout and query-safe adapters when no project is loaded", () => {
    const piano = createPianoViewGeometry(null, pianoViewport);
    const lanes = createVoiceLaneViewGeometry(null, laneViewport);

    expect(lanes.laneRows).toEqual([]);
    expect(hitTestNoteAtPoint({ x: 200, y: 20 }, [], piano)).toBeNull();
    expect(hitTestNotesInRect({ x0: 0, y0: 0, x1: 400, y1: 200 }, [], lanes)).toEqual([]);
    expect(piano.revealTarget([])).toBeNull();
  });
});

describe("canonical note rectangles", () => {
  it("matches the existing piano geometry, including minimum note width", () => {
    const geometry = createPianoViewGeometry(project, pianoViewport);

    expect(geometry.noteRect(longNote)).toEqual({ left: 56, top: 209, right: 856, bottom: 259 });
    expect(geometry.noteRect(shortNote)).toEqual({ left: 156, top: 1, right: 256, bottom: 51 });
    expect(geometry.noteRect(zeroDurationNote)).toEqual({
      left: 556,
      top: 105,
      right: 558,
      bottom: 155,
    });
  });

  it("converts the existing lane rectangle and rejects orphan voices", () => {
    const geometry = createVoiceLaneViewGeometry(project, laneViewport);

    expect(geometry.noteRect(highLaneNote)).toEqual({
      left: 216,
      top: 106,
      right: 456,
      bottom: 118,
    });
    expect(geometry.noteRect(orphanNote)).toBeNull();
  });

  it("keeps a single-pitch voice note inside its lane", () => {
    const singleNote = note({ pitch: 60 });
    const singleProject = {
      ...project,
      voices: [voice({ lowestPitch: 60, highestPitch: 60, noteCount: 1 })],
      notes: [singleNote],
    };
    const geometry = createVoiceLaneViewGeometry(singleProject, laneViewport);
    const lane = geometry.laneRows?.[0];
    const rect = geometry.noteRect(singleNote);

    expect(lane).toBeDefined();
    expect(rect).not.toBeNull();
    expect(rect?.top).toBeGreaterThanOrEqual(lane?.y ?? 0);
    expect(rect?.bottom).toBeLessThanOrEqual((lane?.y ?? 0) + (lane?.height ?? 0));
  });

  it("returns finite rectangles for degenerate viewport spans", () => {
    const degenerateViewport: PianoRollViewport = {
      width: 0,
      height: 0,
      startTick: 0,
      endTick: 0,
      lowestPitch: 64,
      highestPitch: 60,
    };
    const pianoRect = createPianoViewGeometry(project, degenerateViewport).noteRect(shortNote);
    const laneRect = createVoiceLaneViewGeometry(project, degenerateViewport).noteRect(shortNote);

    expect(pianoRect).not.toBeNull();
    expect(Object.values(pianoRect ?? {}).every(Number.isFinite)).toBe(true);
    expect(laneRect).toBeNull();
  });

  it("clips notes in partial top and bottom lane rows and rejects offscreen notes", () => {
    const denseProject = denseLaneProject();
    const geometry = createVoiceLaneViewGeometry(denseProject, denseLaneViewport, {
      laneHeight: 36,
      scrollTopPx: 10,
    });

    expect(geometry.laneRows?.map((lane) => lane.voiceId)).toEqual([
      "voice-1",
      "voice-2",
      "voice-3",
    ]);
    expect(geometry.noteRect(denseProject.notes[0])).toMatchObject({ top: 0, bottom: 8 });
    expect(geometry.noteRect(denseProject.notes[2])).toMatchObject({ top: 68, bottom: 72 });
    expect(geometry.noteRect(denseProject.notes[3])).toBeNull();
    expect(hitTestNoteAtPoint({ x: 200, y: 70 }, [denseProject.notes[3]], geometry)).toBeNull();
  });

  it("clips partially visible notes to each gutter and drops fully hidden notes", () => {
    const partial = note({ id: "partial", pitch: 64, startTick: 0, endTick: 100 });
    const hidden = note({ id: "hidden", pitch: 64, startTick: 0, endTick: 40, durationTicks: 40 });
    const scrolledPiano = { ...pianoViewport, startTick: 50, endTick: 150 };
    const scrolledLanes = { ...laneViewport, startTick: 50, endTick: 150 };
    const scrolledProject = { ...project, notes: [partial, hidden] };
    const piano = createPianoViewGeometry(scrolledProject, scrolledPiano);
    const lanes = createVoiceLaneViewGeometry(scrolledProject, scrolledLanes);

    expect(piano.noteRect(partial)).toMatchObject({ left: PIANO_VIEW_GUTTER_WIDTH, right: 556 });
    expect(lanes.noteRect(partial)).toMatchObject({ left: VOICE_LANE_LABEL_WIDTH, right: 596 });
    expect(piano.noteRect(hidden)).toBeNull();
    expect(lanes.noteRect(hidden)).toBeNull();
  });
});

describe("generic point and rectangle queries", () => {
  const queryCases = [
    {
      name: "piano",
      geometry: createPianoViewGeometry(project, pianoViewport),
      target: shortNote,
    },
    {
      name: "voice lanes",
      geometry: createVoiceLaneViewGeometry(project, laneViewport),
      target: shortNote,
    },
  ];

  for (const { name, geometry, target } of queryCases) {
    it(`finds the same bound note with forward and inverted ${name} queries`, () => {
      const rect = geometry.noteRect(target);
      expect(rect).not.toBeNull();
      if (!rect) {
        return;
      }

      const center = { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
      expect(hitTestNoteAtPoint(center, project.notes, geometry)).toBe(target);

      const forward = {
        x0: rect.left + 1,
        y0: rect.top + 1,
        x1: rect.right - 1,
        y1: rect.bottom - 1,
      };
      const inverted = { x0: forward.x1, y0: forward.y1, x1: forward.x0, y1: forward.y0 };
      expect(hitTestNotesInRect(forward, project.notes, geometry)).toEqual([target]);
      expect(hitTestNotesInRect(inverted, project.notes, geometry)).toEqual([target]);
      expect(
        hitTestNotesInRect(
          {
            x0: 0,
            y0: 0,
            x1: geometry.gutterWidth - 1,
            y1: geometry.noteRect(target)?.bottom ?? 0,
          },
          project.notes,
          geometry,
        ),
      ).toEqual([]);
    });
  }

  it("applies duration, start, pitch, and stable-id point-hit priority without mutation", () => {
    const sharedRect = { left: 20, top: 20, right: 80, bottom: 80 };
    const geometry = geometryWithRects(() => sharedRect);
    const hit = (candidates: MidiNote[]) =>
      hitTestNoteAtPoint({ x: 40, y: 40 }, candidates, geometry);

    expect(
      hit([note({ id: "longer", durationTicks: 200 }), note({ id: "shorter", durationTicks: 100 })])
        ?.id,
    ).toBe("shorter");
    expect(
      hit([note({ id: "early", startTick: 90 }), note({ id: "late", startTick: 100 })])?.id,
    ).toBe("late");
    expect(hit([note({ id: "low", pitch: 60 }), note({ id: "high", pitch: 61 })])?.id).toBe("high");

    const candidates = [note({ id: "z" }), note({ id: "a" })];
    expect(hit(candidates)?.id).toBe("a");
    expect(candidates.map((candidate) => candidate.id)).toEqual(["z", "a"]);
  });

  it("keeps rectangle hits in source order, includes touching edges, and skips null geometry", () => {
    const first = note({ id: "first" });
    const skipped = note({ id: "skipped" });
    const second = note({ id: "second" });
    const sharedRect = { left: 20, top: 20, right: 80, bottom: 80 };
    const candidates = [first, skipped, second];
    const geometry = geometryWithRects((candidate) => (candidate === skipped ? null : sharedRect));

    expect(hitTestNotesInRect({ x0: 80, y0: 30, x1: 100, y1: 40 }, candidates, geometry)).toEqual([
      first,
      second,
    ]);
  });

  it("enforces gutter visibility even for a raw custom geometry", () => {
    const hidden = note({ id: "hidden" });
    const partial = note({ id: "partial" });
    const candidates = [hidden, partial];
    const geometry = geometryWithRects(
      (candidate) =>
        candidate === hidden
          ? { left: 0, top: 10, right: 56, bottom: 30 }
          : { left: 0, top: 40, right: 60, bottom: 60 },
      56,
    );

    expect(hitTestNoteAtPoint({ x: 56, y: 20 }, candidates, geometry)).toBeNull();
    expect(hitTestNoteAtPoint({ x: 55, y: 50 }, candidates, geometry)).toBeNull();
    expect(hitTestNoteAtPoint({ x: 58, y: 50 }, candidates, geometry)).toBe(partial);
  });

  it("queries only the caller's filtered interaction note set", () => {
    const geometry = createPianoViewGeometry(project, pianoViewport);
    const rect = geometry.noteRect(longNote);
    expect(rect).not.toBeNull();
    if (!rect) {
      return;
    }

    const center = { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
    const dragRect = { x0: rect.left, y0: rect.top, x1: rect.right, y1: rect.bottom };
    expect(hitTestNoteAtPoint(center, [shortNote], geometry)).toBeNull();
    expect(hitTestNotesInRect(dragRect, [shortNote], geometry)).toEqual([]);
    expect(hitTestNoteAtPoint(center, [longNote], geometry)).toBe(longNote);
    expect(hitTestNotesInRect(dragRect, [longNote], geometry)).toEqual([longNote]);
  });
});

describe("generic brush and lasso queries", () => {
  const queryCases = [
    { name: "piano", geometry: createPianoViewGeometry(project, pianoViewport) },
    { name: "voice lanes", geometry: createVoiceLaneViewGeometry(project, laneViewport) },
  ];

  for (const { name, geometry } of queryCases) {
    it(`captures a ${name} note across a fast brush sweep`, () => {
      const rect = geometry.noteRect(shortNote);
      expect(rect).not.toBeNull();
      if (!rect) {
        return;
      }

      const y = (rect.top + rect.bottom) / 2;
      expect(
        notesInBrushStampForView(
          { x: rect.left - 20, y },
          { x: rect.right + 20, y },
          0,
          project.notes,
          geometry,
        ),
      ).toEqual([shortNote]);
    });

    it(`captures ${name} note enclosure and a loop drawn inside the note`, () => {
      const rect = geometry.noteRect(shortNote);
      expect(rect).not.toBeNull();
      if (!rect) {
        return;
      }

      const enclosing = [
        { x: rect.left - 2, y: rect.top - 2 },
        { x: rect.right + 2, y: rect.top - 2 },
        { x: rect.right + 2, y: rect.bottom + 2 },
        { x: rect.left - 2, y: rect.bottom + 2 },
      ];
      const centerX = (rect.left + rect.right) / 2;
      const centerY = (rect.top + rect.bottom) / 2;
      const inside = [
        { x: centerX - 2, y: centerY - 2 },
        { x: centerX + 2, y: centerY - 2 },
        { x: centerX, y: centerY + 2 },
      ];

      expect(notesInLassoPathForView(enclosing, project.notes, geometry)).toEqual([shortNote]);
      expect(notesInLassoPathForView(inside, project.notes, geometry)).toEqual([shortNote]);
    });
  }

  it("captures edge intersections but rejects degenerate and empty lassos", () => {
    const target = note({ id: "target" });
    const rect = { left: 20, top: 20, right: 80, bottom: 80 };
    const geometry = geometryWithRects(() => rect);

    expect(
      notesInLassoPathForView(
        [
          { x: 0, y: 48 },
          { x: 100, y: 48 },
          { x: 100, y: 52 },
          { x: 0, y: 52 },
        ],
        [target],
        geometry,
      ),
    ).toEqual([target]);
    expect(
      notesInLassoPathForView(
        [
          { x: 0, y: 0 },
          { x: 5, y: 5 },
        ],
        [target],
        geometry,
      ),
    ).toEqual([]);
    expect(
      notesInLassoPathForView(
        [
          { x: 100, y: 100 },
          { x: 120, y: 100 },
          { x: 110, y: 120 },
        ],
        [target],
        geometry,
      ),
    ).toEqual([]);
  });

  it("uses brush radius and preserves source order across a multi-note sweep", () => {
    const target = note({ id: "target" });
    const targetGeometry = geometryWithRects(() => ({
      left: 20,
      top: 20,
      right: 80,
      bottom: 80,
    }));
    const nearbyPoint = { x: 40, y: 119 };

    expect(
      notesInBrushStampForView(nearbyPoint, nearbyPoint, 10, [target], targetGeometry),
    ).toEqual([]);
    expect(
      notesInBrushStampForView(nearbyPoint, nearbyPoint, 45, [target], targetGeometry),
    ).toEqual([target]);

    const first = note({ id: "first" });
    const second = note({ id: "second" });
    const sweepNotes = [second, first];
    const sweepGeometry = geometryWithRects((candidate) =>
      candidate === first
        ? { left: 20, top: 20, right: 40, bottom: 40 }
        : { left: 80, top: 20, right: 100, bottom: 40 },
    );
    expect(
      notesInBrushStampForView({ x: 0, y: 30 }, { x: 120, y: 30 }, 0, sweepNotes, sweepGeometry),
    ).toEqual([second, first]);
  });

  it("clips partial-gutter brush and lasso queries to visible pixels", () => {
    const target = note({ id: "partial" });
    const geometry = geometryWithRects(() => ({ left: 0, top: 20, right: 60, bottom: 40 }), 56);

    expect(
      notesInBrushStampForView({ x: 50, y: 30 }, { x: 50, y: 30 }, 0, [target], geometry),
    ).toEqual([]);
    expect(
      notesInBrushStampForView({ x: 58, y: 30 }, { x: 58, y: 30 }, 0, [target], geometry),
    ).toEqual([target]);
    expect(
      notesInLassoPathForView(
        [
          { x: 40, y: 15 },
          { x: 55, y: 15 },
          { x: 55, y: 45 },
          { x: 40, y: 45 },
        ],
        [target],
        geometry,
      ),
    ).toEqual([]);
    expect(
      notesInLassoPathForView(
        [
          { x: 57, y: 25 },
          { x: 59, y: 25 },
          { x: 59, y: 35 },
          { x: 57, y: 35 },
        ],
        [target],
        geometry,
      ),
    ).toEqual([target]);
  });

  it("skips null note rectangles in brush and lasso queries", () => {
    const orphan = note({ id: "orphan" });
    const visible = note({ id: "visible" });
    const queryNotes = [orphan, visible];
    const geometry = geometryWithRects((candidate) =>
      candidate === orphan ? null : { left: 20, top: 20, right: 80, bottom: 80 },
    );

    expect(
      notesInBrushStampForView({ x: 0, y: 50 }, { x: 100, y: 50 }, 0, queryNotes, geometry),
    ).toEqual([visible]);
    expect(
      notesInLassoPathForView(
        [
          { x: 15, y: 15 },
          { x: 85, y: 15 },
          { x: 85, y: 85 },
          { x: 15, y: 85 },
        ],
        queryNotes,
        geometry,
      ),
    ).toEqual([visible]);
  });

  it("excludes rectangles fully hidden behind the gutter from brush and lasso", () => {
    const target = note({ id: "hidden" });
    const geometry = geometryWithRects(() => ({ left: 0, top: 20, right: 10, bottom: 40 }), 10);

    expect(
      notesInBrushStampForView({ x: 5, y: 30 }, { x: 5, y: 30 }, 100, [target], geometry),
    ).toEqual([]);
    expect(
      notesInLassoPathForView(
        [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 60 },
          { x: 0, y: 60 },
        ],
        [target],
        geometry,
      ),
    ).toEqual([]);
  });

  it("keeps brush and lasso inside the caller's filtered interaction note set", () => {
    const geometry = createPianoViewGeometry(project, pianoViewport);
    const rect = geometry.noteRect(longNote);
    expect(rect).not.toBeNull();
    if (!rect) {
      return;
    }

    const y = (rect.top + rect.bottom) / 2;
    const enclosing = [
      { x: rect.left - 2, y: rect.top - 2 },
      { x: rect.right + 2, y: rect.top - 2 },
      { x: rect.right + 2, y: rect.bottom + 2 },
      { x: rect.left - 2, y: rect.bottom + 2 },
    ];
    expect(
      notesInBrushStampForView(
        { x: rect.left - 2, y },
        { x: rect.right + 2, y },
        0,
        [shortNote],
        geometry,
      ),
    ).toEqual([]);
    expect(notesInLassoPathForView(enclosing, [shortNote], geometry)).toEqual([]);
    expect(
      notesInBrushStampForView(
        { x: rect.left - 2, y },
        { x: rect.right + 2, y },
        0,
        [longNote],
        geometry,
      ),
    ).toEqual([longNote]);
    expect(notesInLassoPathForView(enclosing, [longNote], geometry)).toEqual([longNote]);
  });
});

describe("view reveal targets", () => {
  it("returns shared time bounds with piano pitch bounds", () => {
    const geometry = createPianoViewGeometry(project, pianoViewport);

    expect(geometry.revealTarget([longNote, shortNote])).toEqual({
      startTick: 0,
      endTick: 800,
      vertical: { kind: "pitch", lowestPitch: 60, highestPitch: 64 },
    });
  });

  it("deduplicates voice IDs in lane order and ignores orphan-only selections", () => {
    const geometry = createVoiceLaneViewGeometry(project, laneViewport);

    expect(geometry.revealTarget([highLaneNote, shortNote, longNote])).toEqual({
      startTick: 0,
      endTick: 800,
      vertical: { kind: "lanes", voiceIds: ["voice-1", "voice-2"] },
    });
    expect(geometry.revealTarget([orphanNote])).toBeNull();
    expect(geometry.revealTarget([orphanNote, shortNote])).toEqual({
      startTick: 100,
      endTick: 200,
      vertical: { kind: "lanes", voiceIds: ["voice-1"] },
    });
  });

  it("returns reveal targets for voices outside the visible lane rows", () => {
    const denseProject = denseLaneProject();
    const geometry = createVoiceLaneViewGeometry(denseProject, denseLaneViewport, {
      laneHeight: 36,
      scrollTopPx: 0,
    });
    const finalNote = denseProject.notes[denseProject.notes.length - 1];

    expect(geometry.laneRows?.some((lane) => lane.voiceId === "voice-6")).toBe(false);
    expect(finalNote).toBeDefined();
    expect(geometry.revealTarget(finalNote ? [finalNote] : [])).toEqual({
      startTick: 100,
      endTick: 200,
      vertical: { kind: "lanes", voiceIds: ["voice-6"] },
    });
  });

  it("returns null for an empty selection in either view", () => {
    expect(createPianoViewGeometry(project, pianoViewport).revealTarget([])).toBeNull();
    expect(createVoiceLaneViewGeometry(project, laneViewport).revealTarget([])).toBeNull();
  });
});
