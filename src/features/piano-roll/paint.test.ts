import { describe, expect, it } from "vitest";
import type { MidiNote, MidiProject } from "../../domain/midi/midiProject";
import type { PianoRollViewport } from "../../domain/midi/viewport";
import { resolvePencilPaintAnchor, resolveWandPaintTarget, shouldPaintNote } from "./paint";
import { createPianoViewGeometry, createVoiceLaneViewGeometry } from "./viewGeometry";

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

const anchor: MidiNote = {
  id: "anchor",
  voiceId: "voice-1",
  sourceTrackIndex: 0,
  channel: 0,
  pitch: 64,
  velocity: 96,
  startTick: 100,
  endTick: 200,
  durationTicks: 100,
  assignmentConfidence: 1,
  assignmentReason: "IMPORTED",
};
const neighbor: MidiNote = {
  ...anchor,
  id: "neighbor",
  pitch: 60,
  startTick: 200,
  endTick: 300,
};
const project: MidiProject = {
  fileName: "paint-anchor.mid",
  format: "single-track",
  ppq: 480,
  durationTicks: 1000,
  trackCount: 1,
  voices: [
    {
      id: "voice-1",
      label: "Lead",
      noteCount: 2,
      lowestPitch: 60,
      highestPitch: 64,
    },
  ],
  notes: [anchor, neighbor],
  tempoChanges: [],
  timeSignatures: [],
  warnings: [],
  separationSummary: { meanConfidence: 1, lowConfidenceNoteCount: 0, voiceCount: 1 },
  strategySuggestion: { strategy: "BALANCED", reason: "test" },
};
const viewport: PianoRollViewport = {
  width: 1056,
  height: 260,
  startTick: 0,
  endTick: 1000,
  lowestPitch: 60,
  highestPitch: 64,
};

describe("paint point anchors", () => {
  const cases = [
    { name: "piano", geometry: createPianoViewGeometry(project, viewport) },
    { name: "voice lanes", geometry: createVoiceLaneViewGeometry(project, viewport) },
  ];

  for (const { name, geometry } of cases) {
    it(`resolves the same pencil and wand anchor through ${name} geometry`, () => {
      const rect = geometry.noteRect(anchor);
      expect(rect).not.toBeNull();
      if (!rect) {
        return;
      }
      const point = { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };

      expect(resolvePencilPaintAnchor(point, project.notes, geometry)).toBe(anchor);
      expect(resolveWandPaintTarget(point, project.notes, geometry, project.ppq, 5)).toEqual({
        anchor,
        phrase: [anchor, neighbor],
      });
      expect(resolvePencilPaintAnchor(point, [neighbor], geometry)).toBeNull();
      expect(resolveWandPaintTarget(point, [neighbor], geometry, project.ppq, 5)).toBeNull();
    });
  }
});
