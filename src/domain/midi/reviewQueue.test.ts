import { describe, expect, it } from "vitest";
import type { MidiNote } from "./midiProject";
import { buildFlaggedNoteQueue, findNextFlaggedNoteId } from "./reviewQueue";

function note(id: string, startTick: number, confidence: number): MidiNote {
  return {
    id,
    voiceId: "voice-1",
    sourceTrackIndex: 0,
    channel: 0,
    pitch: 60,
    velocity: 100,
    startTick,
    endTick: startTick + 120,
    durationTicks: 120,
    assignmentConfidence: confidence,
    assignmentReason: "CLOSEST_PITCH",
  };
}

describe("buildFlaggedNoteQueue", () => {
  it("keeps only low-confidence notes, sorted by start tick", () => {
    const notes = [note("c", 480, 0.2), note("a", 0, 0.4), note("b", 240, 0.9)];

    const queue = buildFlaggedNoteQueue(notes);

    expect(queue.map((flagged) => flagged.id)).toEqual(["a", "c"]);
  });

  it("returns an empty queue when nothing is flagged", () => {
    expect(buildFlaggedNoteQueue([note("a", 0, 0.9)])).toEqual([]);
  });
});

describe("findNextFlaggedNoteId", () => {
  const queue = [note("a", 0, 0.1), note("b", 240, 0.1), note("c", 480, 0.1)];

  it("returns null for an empty queue", () => {
    expect(findNextFlaggedNoteId([], null, 1)).toBeNull();
  });

  it("jumps to the first flagged note when nothing is selected", () => {
    expect(findNextFlaggedNoteId(queue, null, 1)).toBe("a");
  });

  it("jumps to the last flagged note when stepping backward with no selection", () => {
    expect(findNextFlaggedNoteId(queue, null, -1)).toBe("c");
  });

  it("steps forward to the next flagged note after the current tick", () => {
    expect(findNextFlaggedNoteId(queue, 0, 1)).toBe("b");
  });

  it("steps backward to the previous flagged note before the current tick", () => {
    expect(findNextFlaggedNoteId(queue, 480, -1)).toBe("b");
  });

  it("wraps forward past the last flagged note", () => {
    expect(findNextFlaggedNoteId(queue, 480, 1)).toBe("a");
  });

  it("wraps backward past the first flagged note", () => {
    expect(findNextFlaggedNoteId(queue, 0, -1)).toBe("c");
  });

  it("jumps to the nearest flagged note when the current selection isn't itself flagged", () => {
    expect(findNextFlaggedNoteId(queue, 100, 1)).toBe("b");
    expect(findNextFlaggedNoteId(queue, 100, -1)).toBe("a");
  });
});
