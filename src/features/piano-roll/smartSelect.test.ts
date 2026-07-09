import { describe, expect, it } from "vitest";
import type { MidiNote } from "../../domain/midi/midiProject";
import {
  chordToleranceTicks,
  clampWandReach,
  MAX_WAND_REACH,
  notesInTickRange,
  MIN_WAND_REACH,
  selectBottomLine,
  selectChord,
  selectPhrase,
  selectTopLine,
} from "./smartSelect";

function makeNote(id: string, pitch: number, startTick: number, endTick: number): MidiNote {
  return {
    id,
    voiceId: "voice-1",
    sourceTrackIndex: 0,
    channel: 0,
    pitch,
    velocity: 80,
    startTick,
    endTick,
    durationTicks: endTick - startTick,
    assignmentConfidence: 1,
    assignmentReason: "IMPORTED",
  };
}

function ids(notes: MidiNote[]): string[] {
  return notes.map((note) => note.id).sort();
}

describe("clampWandReach", () => {
  it("rounds and clamps into the allowed range", () => {
    expect(clampWandReach(4.6)).toBe(5);
    expect(clampWandReach(0)).toBe(MIN_WAND_REACH);
    expect(clampWandReach(99)).toBe(MAX_WAND_REACH);
  });
});

describe("chordToleranceTicks", () => {
  it("is a 32nd note at the project's resolution, never below 1", () => {
    expect(chordToleranceTicks(480)).toBe(60);
    expect(chordToleranceTicks(4)).toBe(1);
  });
});

describe("selectChord", () => {
  const chordRoot = makeNote("root", 60, 480, 960);
  const chordThird = makeNote("third", 64, 480, 960);
  const chordFifthLoose = makeNote("fifth", 67, 500, 940); // within ±60 of the root
  const laterNote = makeNote("later", 72, 960, 1440);
  const sameStartLongerEnd = makeNote("held", 55, 480, 1920);
  const notes = [chordRoot, chordThird, chordFifthLoose, laterNote, sameStartLongerEnd];

  it("selects every note stacked within the tolerance, including the anchor", () => {
    expect(ids(selectChord(chordRoot, notes, 60))).toEqual(["fifth", "root", "third"]);
  });

  it("excludes a note sharing only the start (different end)", () => {
    expect(ids(selectChord(chordRoot, notes, 60))).not.toContain("held");
  });

  it("tightening the tolerance drops loosely aligned notes", () => {
    expect(ids(selectChord(chordRoot, notes, 10))).toEqual(["root", "third"]);
  });
});

describe("selectTopLine / selectBottomLine", () => {
  it("keeps only the highest note of a block chord", () => {
    const notes = [makeNote("c", 60, 0, 480), makeNote("e", 64, 0, 480), makeNote("g", 67, 0, 480)];
    expect(ids(selectTopLine(notes))).toEqual(["g"]);
    expect(ids(selectBottomLine(notes))).toEqual(["c"]);
  });

  it("follows the skyline across sequential chords", () => {
    const notes = [
      makeNote("c1", 60, 0, 480),
      makeNote("g1", 67, 0, 480),
      makeNote("d2", 62, 480, 960),
      makeNote("a2", 69, 480, 960),
    ];
    expect(ids(selectTopLine(notes))).toEqual(["a2", "g1"]);
    expect(ids(selectBottomLine(notes))).toEqual(["c1", "d2"]);
  });

  it("includes a note that becomes the highest partway through its span", () => {
    // "lead" is masked by "spike" for its first half, then becomes the top.
    const lead = makeNote("lead", 65, 0, 960);
    const spike = makeNote("spike", 72, 0, 480);
    expect(ids(selectTopLine([lead, spike]))).toEqual(["lead", "spike"]);
  });

  it("excludes a note that is never the highest", () => {
    const held = makeNote("held", 72, 0, 960);
    const buried = makeNote("buried", 60, 240, 720);
    expect(ids(selectTopLine([held, buried]))).toEqual(["held"]);
  });

  it("keeps unison ties together instead of dropping one arbitrarily", () => {
    const notes = [makeNote("u1", 67, 0, 480), makeNote("u2", 67, 0, 480)];
    expect(ids(selectTopLine(notes))).toEqual(["u1", "u2"]);
  });

  it("returns nothing for an empty selection", () => {
    expect(selectTopLine([])).toEqual([]);
  });
});

describe("selectPhrase", () => {
  const options = { maxGapTicks: 480, maxPitchJumpSemitones: 5 };

  it("walks a connected run in both directions from a mid-phrase anchor", () => {
    const run = [
      makeNote("n1", 60, 0, 480),
      makeNote("n2", 62, 480, 960),
      makeNote("n3", 64, 960, 1440),
      makeNote("n4", 65, 1440, 1920),
    ];
    expect(ids(selectPhrase(run[2], run, options))).toEqual(["n1", "n2", "n3", "n4"]);
  });

  it("stops at a pitch jump beyond the reach", () => {
    const notes = [
      makeNote("low1", 60, 0, 480),
      makeNote("low2", 62, 480, 960),
      makeNote("high", 76, 960, 1440), // 14 semitones up — a different line
    ];
    expect(ids(selectPhrase(notes[0], notes, options))).toEqual(["low1", "low2"]);
  });

  it("stops at a silence longer than the gap limit", () => {
    const notes = [
      makeNote("a", 60, 0, 480),
      makeNote("b", 60, 2000, 2480), // 1520 ticks of silence
    ];
    expect(ids(selectPhrase(notes[0], notes, options))).toEqual(["a"]);
  });

  it("treats overlapping notes as connected", () => {
    const notes = [makeNote("a", 60, 0, 600), makeNote("b", 63, 480, 960)];
    expect(ids(selectPhrase(notes[0], notes, options))).toEqual(["a", "b"]);
  });

  it("hops across an intermediate note to reach far pitches", () => {
    // 60 -> 64 -> 68: each hop is within reach even though the ends are not.
    const notes = [
      makeNote("a", 60, 0, 480),
      makeNote("b", 64, 480, 960),
      makeNote("c", 68, 960, 1440),
    ];
    expect(ids(selectPhrase(notes[0], notes, options))).toEqual(["a", "b", "c"]);
  });
});

describe("notesInTickRange", () => {
  const notes = [
    makeNote("before", 60, 0, 480),
    makeNote("inside", 62, 500, 900),
    makeNote("straddling", 64, 800, 1600),
    makeNote("after", 65, 1600, 2000),
  ];

  it("selects notes sounding anywhere inside the range, regardless of pitch", () => {
    expect(ids(notesInTickRange(notes, 490, 1000))).toEqual(["inside", "straddling"]);
  });

  it("accepts a backwards drag (endTick before startTick)", () => {
    expect(ids(notesInTickRange(notes, 1000, 490))).toEqual(["inside", "straddling"]);
  });

  it("excludes notes that only touch the range boundary", () => {
    expect(ids(notesInTickRange(notes, 480, 500))).toEqual([]);
  });
});
