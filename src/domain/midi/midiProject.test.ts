import { describe, expect, it } from "vitest";
import { formatProjectSummary, type MidiProject } from "./midiProject";

describe("formatProjectSummary", () => {
  it("formats an empty project state", () => {
    expect(formatProjectSummary(null)).toBe("Notes: 0 | Tracks: 0 | PPQ: - | Duration: 0 ticks");
  });

  it("formats imported project metrics", () => {
    const project: MidiProject = {
      fileName: "song.mid",
      format: "parallel",
      ppq: 480,
      durationTicks: 960,
      trackCount: 2,
      notes: [
        {
          id: "note-1",
          sourceTrackIndex: 0,
          channel: 0,
          pitch: 60,
          velocity: 100,
          startTick: 0,
          endTick: 240,
          durationTicks: 240,
        },
      ],
      tempoChanges: [],
      timeSignatures: [],
      warnings: [],
    };

    expect(formatProjectSummary(project)).toBe(
      "Notes: 1 | Tracks: 2 | PPQ: 480 | Duration: 960 ticks",
    );
  });
});
