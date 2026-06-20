import { describe, expect, it } from "vitest";
import type { MidiNote } from "./midiProject";
import {
  buildVoiceList,
  mergeVoiceOrder,
  mergeVoiceOverrides,
  nextVoiceId,
  reconcileVoiceOrderAfterReassign,
} from "./voiceManagement";

function note(id: string, voiceId: string, pitch: number): MidiNote {
  return {
    id,
    voiceId,
    sourceTrackIndex: 0,
    channel: 0,
    pitch,
    velocity: 100,
    startTick: 0,
    endTick: 240,
    durationTicks: 240,
    assignmentConfidence: 1,
    assignmentReason: "IMPORTED",
  };
}

describe("nextVoiceId", () => {
  it("starts at voice-1 for an empty order", () => {
    expect(nextVoiceId([])).toBe("voice-1");
  });

  it("picks one past the highest existing voice number", () => {
    expect(nextVoiceId(["voice-1", "voice-3"])).toBe("voice-4");
  });
});

describe("buildVoiceList", () => {
  it("computes note counts and pitch ranges per voice in order", () => {
    const notes = [note("a", "voice-1", 60), note("b", "voice-1", 64), note("c", "voice-2", 72)];

    const voices = buildVoiceList(["voice-1", "voice-2"], {}, notes);

    expect(voices).toEqual([
      { id: "voice-1", label: "Voice 1", noteCount: 2, lowestPitch: 60, highestPitch: 64 },
      { id: "voice-2", label: "Voice 2", noteCount: 1, lowestPitch: 72, highestPitch: 72 },
    ]);
  });

  it("uses a custom label when one is set", () => {
    const voices = buildVoiceList(["voice-1"], { "voice-1": "Lead" }, []);

    expect(voices[0].label).toBe("Lead");
  });

  it("returns zero-pitch placeholders for a voice with no notes", () => {
    const voices = buildVoiceList(["voice-1"], {}, []);

    expect(voices[0]).toEqual({
      id: "voice-1",
      label: "Voice 1",
      noteCount: 0,
      lowestPitch: 0,
      highestPitch: 0,
    });
  });
});

describe("mergeVoiceOrder", () => {
  it("appends new voice ids not already in the order", () => {
    expect(mergeVoiceOrder(["voice-1"], ["voice-1", "voice-2"])).toEqual(["voice-1", "voice-2"]);
  });

  it("sorts newly appended ids numerically rather than lexicographically", () => {
    expect(mergeVoiceOrder([], ["voice-10", "voice-2"])).toEqual(["voice-2", "voice-10"]);
    expect(mergeVoiceOrder([], ["voice-2", "voice-10"])).toEqual(["voice-2", "voice-10"]);
  });

  it("leaves the order unchanged when there are no new ids", () => {
    expect(mergeVoiceOrder(["voice-1", "voice-2"], ["voice-1"])).toEqual(["voice-1", "voice-2"]);
  });
});

describe("reconcileVoiceOrderAfterReassign", () => {
  it("drops voice ids no note is assigned to anymore", () => {
    expect(
      reconcileVoiceOrderAfterReassign(
        ["voice-1", "voice-2", "voice-3", "voice-4"],
        ["voice-1", "voice-2", "voice-1"],
      ),
    ).toEqual(["voice-1", "voice-2"]);
  });

  it("appends brand-new voice ids the reassignment introduced", () => {
    expect(reconcileVoiceOrderAfterReassign(["voice-1"], ["voice-1", "voice-2"])).toEqual([
      "voice-1",
      "voice-2",
    ]);
  });

  it("preserves existing relative order for ids that survive", () => {
    expect(
      reconcileVoiceOrderAfterReassign(["voice-3", "voice-1", "voice-2"], ["voice-1", "voice-2"]),
    ).toEqual(["voice-1", "voice-2"]);
  });

  it("returns an empty order when no notes remain", () => {
    expect(reconcileVoiceOrderAfterReassign(["voice-1", "voice-2"], [])).toEqual([]);
  });
});

describe("mergeVoiceOverrides", () => {
  it("patches every note in the source voice to the target voice", () => {
    const notes = [note("a", "voice-1", 60), note("b", "voice-2", 64), note("c", "voice-1", 67)];

    const overrides = mergeVoiceOverrides(notes, "voice-1", "voice-2");

    expect(overrides).toEqual({ a: "voice-2", c: "voice-2" });
  });

  it("returns no patches when the source voice has no notes", () => {
    const notes = [note("a", "voice-2", 60)];

    expect(mergeVoiceOverrides(notes, "voice-1", "voice-2")).toEqual({});
  });
});
