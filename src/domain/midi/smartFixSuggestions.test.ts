import { describe, expect, it } from "vitest";
import type { MidiNote, MidiVoice } from "./midiProject";
import { buildSmartFixSuggestions, formatSmartFixActionDetail } from "./smartFixSuggestions";

function note(
  id: string,
  voiceId: string,
  pitch: number,
  startTick: number,
  overrides: Partial<MidiNote> = {},
): MidiNote {
  return {
    id,
    voiceId,
    sourceTrackIndex: 0,
    channel: 0,
    pitch,
    velocity: 100,
    startTick,
    endTick: startTick + 120,
    durationTicks: 120,
    assignmentConfidence: 0.95,
    assignmentReason: "CLOSEST_PITCH",
    ...overrides,
  };
}

function voice(
  id: string,
  label: string,
  noteCount: number,
  lowestPitch: number,
  highestPitch: number,
): MidiVoice {
  return { id, label, noteCount, lowestPitch, highestPitch };
}

function suggestions(
  notes: MidiNote[],
  voices: MidiVoice[],
  lockedNoteIds: ReadonlySet<string> = new Set(),
) {
  return buildSmartFixSuggestions({ notes, voices, lockedNoteIds });
}

describe("buildSmartFixSuggestions", () => {
  it("suggests selecting a nearby low-confidence cluster", () => {
    const result = suggestions(
      [
        note("a", "voice-1", 60, 0, { assignmentConfidence: 0.2 }),
        note("b", "voice-2", 64, 240, { assignmentConfidence: 0.3 }),
        note("far", "voice-1", 67, 2400, { assignmentConfidence: 0.1 }),
      ],
      [voice("voice-1", "Lead", 2, 60, 67), voice("voice-2", "Bass", 1, 64, 64)],
    );

    expect(result[0]).toMatchObject({
      title: "Review 2 nearby low-confidence notes",
      action: { type: "select", noteIds: ["a", "b"] },
    });
  });

  it("suggests merging a tiny voice into the nearest non-overlapping voice", () => {
    const result = suggestions(
      [note("a", "voice-1", 60, 0), note("b", "voice-2", 62, 240)],
      [voice("voice-1", "Lead", 1, 60, 60), voice("voice-2", "Lead helper", 1, 62, 62)],
    );

    expect(result.some((suggestion) => suggestion.action.type === "merge")).toBe(true);
    const merge = result.find((suggestion) => suggestion.action.type === "merge");
    expect(merge).toMatchObject({
      title: "Merge tiny voice into Lead helper",
      action: { type: "merge", sourceVoiceId: "voice-1", targetVoiceId: "voice-2" },
    });
  });

  it("does not suggest merging into or out of percussion", () => {
    const result = suggestions(
      [note("kick", "percussion", 36, 0), note("a", "voice-1", 60, 240)],
      [voice("percussion", "Percussion", 1, 36, 36), voice("voice-1", "Lead", 1, 60, 60)],
    );

    expect(result.some((suggestion) => suggestion.action.type === "merge")).toBe(false);
  });

  it("suggests reconnecting an adjacent phrase split across voices", () => {
    const result = suggestions(
      [
        note("lead-a", "voice-1", 60, 0),
        note("lead-b", "voice-1", 62, 240),
        note("split", "voice-2", 64, 480),
        note("other", "voice-2", 84, 1440),
      ],
      [voice("voice-1", "Lead", 2, 60, 62), voice("voice-2", "Other", 2, 64, 84)],
    );

    expect(result.find((suggestion) => suggestion.action.type === "assign")).toMatchObject({
      title: "Reconnect phrase into Lead",
      action: { type: "assign", noteIds: ["split"], targetVoiceId: "voice-1" },
    });
  });

  it("does not suggest edits touching locked notes", () => {
    const result = suggestions(
      [note("a", "voice-1", 60, 0), note("b", "voice-2", 62, 240)],
      [voice("voice-1", "Lead", 1, 60, 60), voice("voice-2", "Other", 1, 62, 62)],
      new Set(["a", "b"]),
    );

    expect(result).toEqual([]);
  });

  it("returns no suggestions for a clean compact file", () => {
    expect(
      suggestions(
        [
          note("a", "voice-1", 60, 0),
          note("b", "voice-1", 62, 240),
          note("c", "voice-2", 72, 0),
          note("d", "voice-2", 74, 240),
        ],
        [voice("voice-1", "Lead", 2, 60, 62), voice("voice-2", "Bass", 2, 72, 74)],
      ),
    ).toEqual([]);
  });
});

describe("formatSmartFixActionDetail", () => {
  it("describes assign actions as locking notes", () => {
    const detail = formatSmartFixActionDetail(
      {
        id: "fixture",
        title: "Fixture",
        reason: "Fixture",
        actionLabel: "Assign note",
        action: { type: "assign", noteIds: ["a"], targetVoiceId: "voice-1" },
      },
      [voice("voice-1", "Lead", 1, 60, 60)],
    );

    expect(detail).toBe("1 note will be locked to Lead.");
  });
});
