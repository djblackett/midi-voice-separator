import { describe, expect, it } from "vitest";
import type { MidiNote } from "./midiProject";
import {
  applyReviewDecision,
  buildFlaggedNoteQueue,
  buildReviewProgress,
  findCurrentFlaggedNote,
  findNextFlaggedNoteId,
} from "./reviewQueue";

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
describe("buildReviewProgress", () => {
  const queue = [note("a", 0, 0.1), note("b", 240, 0.1), note("c", 480, 0.1)];

  it("derives reviewed notes from overrides and skipped ids", () => {
    const progress = buildReviewProgress(queue, { a: "voice-1" }, new Set(["c"]));

    expect(progress).toEqual({ flaggedCount: 3, reviewedCount: 2, remainingCount: 1 });
  });

  it("ignores overrides and skipped ids for notes not currently flagged", () => {
    const progress = buildReviewProgress(queue, { missing: "voice-1" }, new Set(["other"]));

    expect(progress).toEqual({ flaggedCount: 3, reviewedCount: 0, remainingCount: 3 });
  });
});

describe("findCurrentFlaggedNote", () => {
  const queue = [note("a", 0, 0.1), note("b", 240, 0.1)];

  it("returns the selected note when exactly one flagged note is selected", () => {
    expect(findCurrentFlaggedNote(queue, new Set(["b"]))?.id).toBe("b");
  });

  it("returns null when selection is empty, plural, or not flagged", () => {
    expect(findCurrentFlaggedNote(queue, new Set())).toBeNull();
    expect(findCurrentFlaggedNote(queue, new Set(["a", "b"]))).toBeNull();
    expect(findCurrentFlaggedNote(queue, new Set(["missing"]))).toBeNull();
  });
});
describe("applyReviewDecision", () => {
  it("writes an override and removes range provenance for the reviewed note", () => {
    const result = applyReviewDecision(
      { existing: "voice-1" },
      new Set(["reviewed", "other"]),
      "reviewed",
      "voice-2",
    );

    expect(result.voiceOverrides).toEqual({ existing: "voice-1", reviewed: "voice-2" });
    expect(result.rangeAssignedNoteIds).toEqual(new Set(["other"]));
  });
});
