import { describe, expect, it } from "vitest";
import { formatMidiWarningLocation, formatProjectSummary, type MidiProject } from "./midiProject";

describe("formatProjectSummary", () => {
  it("formats an empty project state", () => {
    expect(formatProjectSummary(null)).toBe(
      "Notes: 0 | Voices: 0 | Tracks: 0 | PPQ: - | Duration: 0 ticks | Tempo changes: 0 | Time signatures: 0",
    );
  });

  it("formats imported project metrics", () => {
    const project: MidiProject = {
      fileName: "song.mid",
      format: "parallel",
      ppq: 480,
      durationTicks: 960,
      trackCount: 2,
      voices: [
        {
          id: "voice-1",
          label: "Voice 1",
          noteCount: 1,
          lowestPitch: 60,
          highestPitch: 60,
        },
      ],
      notes: [
        {
          id: "note-1",
          voiceId: "voice-1",
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
      timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }],
      warnings: [],
    };

    expect(formatProjectSummary(project)).toBe(
      "Notes: 1 | Voices: 1 | Tracks: 2 | PPQ: 480 | Duration: 960 ticks | Tempo changes: 0 | Time signatures: 1",
    );
  });
});

describe("formatMidiWarningLocation", () => {
  it("formats track and tick metadata", () => {
    expect(
      formatMidiWarningLocation({
        code: "DANGLING_NOTE_ON",
        message: "Closed dangling note.",
        trackIndex: 1,
        tick: 960,
      }),
    ).toBe("track 1, tick 960");
  });

  it("falls back when warning metadata is absent", () => {
    expect(
      formatMidiWarningLocation({
        code: "UNMATCHED_NOTE_OFF",
        message: "Ignored note-off.",
        trackIndex: null,
        tick: null,
      }),
    ).toBe("unknown location");
  });
});
