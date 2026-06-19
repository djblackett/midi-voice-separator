import { describe, expect, it } from "vitest";
import {
  formatMidiChannel,
  formatMidiWarningLocation,
  formatProjectSummary,
  formatSelectedNote,
  formatSeparationSummary,
  type MidiProject,
} from "./midiProject";

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
          assignmentConfidence: 1,
          assignmentReason: "IMPORTED",
        },
      ],
      tempoChanges: [],
      timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }],
      warnings: [],
      separationSummary: { meanConfidence: 1, lowConfidenceNoteCount: 0, voiceCount: 1 },
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

describe("note formatting", () => {
  it("formats MIDI channels for users as one-based values", () => {
    expect(formatMidiChannel(9)).toBe("Channel 10");
  });

  it("formats selected note details", () => {
    expect(
      formatSelectedNote({
        id: "note-1",
        voiceId: "voice-2",
        sourceTrackIndex: 0,
        channel: 1,
        pitch: 64,
        velocity: 90,
        startTick: 120,
        endTick: 360,
        durationTicks: 240,
        assignmentConfidence: 0.8,
        assignmentReason: "CLOSEST_PITCH",
      }),
    ).toBe("Pitch 64 | Channel 2 | 120-360 ticks | voice-2");
  });

  it("formats the empty selected-note state", () => {
    expect(formatSelectedNote(null)).toBe("No note selected");
  });
});

describe("formatSeparationSummary", () => {
  it("reports mean confidence and flagged-note count", () => {
    expect(
      formatSeparationSummary(
        { meanConfidence: 0.91, lowConfidenceNoteCount: 14, voiceCount: 3 },
        200,
      ),
    ).toBe("91% mean assignment confidence — 14 notes flagged for review.");
  });

  it("uses singular phrasing for exactly one flagged note", () => {
    expect(
      formatSeparationSummary(
        { meanConfidence: 0.95, lowConfidenceNoteCount: 1, voiceCount: 2 },
        50,
      ),
    ).toBe("95% mean assignment confidence — 1 note flagged for review.");
  });

  it("reports no flagged notes", () => {
    expect(
      formatSeparationSummary({ meanConfidence: 1, lowConfidenceNoteCount: 0, voiceCount: 1 }, 10),
    ).toBe("100% mean assignment confidence — no notes flagged for review.");
  });

  it("handles an empty project", () => {
    expect(
      formatSeparationSummary({ meanConfidence: 1, lowConfidenceNoteCount: 0, voiceCount: 0 }, 0),
    ).toBe("No notes to separate.");
  });
});
