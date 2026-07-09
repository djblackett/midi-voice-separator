import { describe, expect, it } from "vitest";
import type { MidiNote } from "./midiProject";
import { PERCUSSION_VOICE_ID } from "./voiceManagement";
import { conflictNoteIds, findNextConflict, findVoiceConflicts } from "./voiceConflicts";

function makeNote(id: string, voiceId: string, startTick: number, endTick: number): MidiNote {
  return {
    id,
    voiceId,
    sourceTrackIndex: 0,
    channel: 0,
    pitch: 60,
    velocity: 80,
    startTick,
    endTick,
    durationTicks: endTick - startTick,
    assignmentConfidence: 1,
    assignmentReason: "IMPORTED",
  };
}

describe("findVoiceConflicts", () => {
  it("finds nothing in a strictly sequential voice", () => {
    const notes = [
      makeNote("a", "voice-1", 0, 480),
      makeNote("b", "voice-1", 480, 960),
      makeNote("c", "voice-1", 960, 1440),
    ];
    expect(findVoiceConflicts(notes)).toEqual([]);
  });

  it("reports a same-voice overlap with the overlap window", () => {
    const notes = [makeNote("a", "voice-1", 0, 600), makeNote("b", "voice-1", 480, 960)];
    expect(findVoiceConflicts(notes)).toEqual([
      { voiceId: "voice-1", noteIds: ["a", "b"], startTick: 480, endTick: 600 },
    ]);
  });

  it("treats touching boundaries (end == next start) as legal monophony", () => {
    const notes = [makeNote("a", "voice-1", 0, 480), makeNote("b", "voice-1", 480, 960)];
    expect(findVoiceConflicts(notes)).toEqual([]);
  });

  it("ignores overlaps across different voices", () => {
    const notes = [makeNote("a", "voice-1", 0, 960), makeNote("b", "voice-2", 0, 960)];
    expect(findVoiceConflicts(notes)).toEqual([]);
  });

  it("exempts the percussion voice, where simultaneous hits are normal", () => {
    const notes = [
      makeNote("kick", PERCUSSION_VOICE_ID, 0, 120),
      makeNote("hat", PERCUSSION_VOICE_ID, 0, 120),
    ];
    expect(findVoiceConflicts(notes)).toEqual([]);
  });

  it("reports every overlapping pair, sorted by overlap start", () => {
    const notes = [
      makeNote("late-a", "voice-2", 1000, 1500),
      makeNote("late-b", "voice-2", 1400, 1900),
      makeNote("early-a", "voice-1", 0, 600),
      makeNote("early-b", "voice-1", 480, 960),
    ];
    const conflicts = findVoiceConflicts(notes);
    expect(conflicts.map((conflict) => conflict.noteIds)).toEqual([
      ["early-a", "early-b"],
      ["late-a", "late-b"],
    ]);
  });

  it("reports each pair of a triple overlap", () => {
    const notes = [
      makeNote("a", "voice-1", 0, 1000),
      makeNote("b", "voice-1", 100, 1100),
      makeNote("c", "voice-1", 200, 1200),
    ];
    expect(findVoiceConflicts(notes)).toHaveLength(3);
  });
});

describe("conflictNoteIds", () => {
  it("collects every involved note id once", () => {
    const conflicts = findVoiceConflicts([
      makeNote("a", "voice-1", 0, 1000),
      makeNote("b", "voice-1", 100, 1100),
      makeNote("c", "voice-1", 200, 1200),
    ]);
    expect([...conflictNoteIds(conflicts)].sort()).toEqual(["a", "b", "c"]);
  });
});

describe("findNextConflict", () => {
  const conflicts = findVoiceConflicts([
    makeNote("a1", "voice-1", 0, 600),
    makeNote("a2", "voice-1", 480, 960),
    makeNote("b1", "voice-1", 2000, 2600),
    makeNote("b2", "voice-1", 2480, 2960),
  ]);

  it("returns null when there are no conflicts", () => {
    expect(findNextConflict([], 0, 1)).toBeNull();
  });

  it("starts from the first conflict when nothing is selected", () => {
    expect(findNextConflict(conflicts, null, 1)?.startTick).toBe(480);
    expect(findNextConflict(conflicts, null, -1)?.startTick).toBe(2480);
  });

  it("steps forward and wraps around", () => {
    expect(findNextConflict(conflicts, 480, 1)?.startTick).toBe(2480);
    expect(findNextConflict(conflicts, 2480, 1)?.startTick).toBe(480);
  });

  it("steps backward and wraps around", () => {
    expect(findNextConflict(conflicts, 2480, -1)?.startTick).toBe(480);
    expect(findNextConflict(conflicts, 480, -1)?.startTick).toBe(2480);
  });
});
