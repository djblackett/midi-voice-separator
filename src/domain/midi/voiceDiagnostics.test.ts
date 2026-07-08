import { describe, expect, it } from "vitest";
import type { MidiNote, MidiProject, MidiVoice } from "./midiProject";
import {
  analyzeVoiceDiagnostics,
  buildSplitVoiceByChannelRepair,
  buildSplitVoiceByPitchRepair,
  flaggedNoteIdsForVoice,
  formatSplitVoiceByChannelRepairLabel,
  formatSplitVoiceByPitchRepairLabel,
  formatVoiceChannelDistribution,
  formatVoiceDiagnosticSummary,
  formatVoiceFlaggedReviewLabel,
  maxSimultaneousPolyphony,
  noteIdsForVoice,
  recommendSeparationAction,
  sortVoiceDiagnosticsForDisplay,
} from "./voiceDiagnostics";

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
    assignmentConfidence: 1,
    assignmentReason: "CLOSEST_PITCH",
    ...overrides,
  };
}

function voice(id: string, label: string, lowestPitch = 60, highestPitch = 60): MidiVoice {
  return { id, label, noteCount: 1, lowestPitch, highestPitch };
}

function project(notes: MidiNote[], voices: MidiVoice[] = [voice("voice-1", "Voice 1")]) {
  return {
    fileName: "fixture.mid",
    format: "parallel",
    ppq: 480,
    durationTicks: 960,
    trackCount: 1,
    voices,
    notes,
    tempoChanges: [],
    timeSignatures: [],
    warnings: [],
    separationSummary: { meanConfidence: 1, lowConfidenceNoteCount: 0, voiceCount: voices.length },
    strategySuggestion: { strategy: "REGISTER_PRIORITY", reason: "fixture" },
  } satisfies MidiProject;
}

describe("analyzeVoiceDiagnostics", () => {
  it("computes per-voice pitch, channel, confidence, cap, and leap metrics", () => {
    const diagnostics = analyzeVoiceDiagnostics(
      project(
        [
          note("a", "voice-1", 28, 0, { channel: 0 }),
          note("b", "voice-1", 91, 120, { channel: 1, assignmentConfidence: 0.2 }),
          note("c", "voice-1", 30, 240, {
            channel: 1,
            assignmentConfidence: 0.1,
            assignmentReason: "VOICE_CAP_REACHED",
          }),
        ],
        [voice("voice-1", "Bass and lead")],
      ),
    );

    expect(diagnostics[0]).toMatchObject({
      voiceId: "voice-1",
      label: "Bass and lead",
      noteCount: 3,
      minPitch: 28,
      maxPitch: 91,
      pitchSpan: 63,
      channelDistribution: { 0: 1, 1: 2 },
      lowConfidenceNoteCount: 2,
      forcedCapNoteCount: 1,
      largeLeapCount: 2,
      suspicious: true,
    });
    expect(diagnostics[0].suspiciousReasons).toEqual([
      "span 63 semitones",
      "2 significant channels",
      "2 large leaps",
      "1 cap-forced notes",
      "2 low-confidence notes",
    ]);
  });

  it("does not flag a compact confident voice", () => {
    const diagnostics = analyzeVoiceDiagnostics(
      project([
        note("a", "voice-1", 60, 0),
        note("b", "voice-1", 64, 120),
        note("c", "voice-1", 67, 240),
      ]),
    );

    expect(diagnostics[0].suspicious).toBe(false);
    expect(diagnostics[0].suspiciousReasons).toEqual([]);
  });

  it("flags a compact voice that mixes multiple significant channels", () => {
    const diagnostics = analyzeVoiceDiagnostics(
      project([
        note("a", "voice-1", 60, 0, { channel: 0 }),
        note("b", "voice-1", 62, 120, { channel: 1 }),
        note("c", "voice-1", 64, 240, { channel: 1 }),
      ]),
    );

    expect(diagnostics[0].suspicious).toBe(true);
    expect(diagnostics[0].suspiciousReasons).toEqual(["2 significant channels"]);
  });
  it("uses voice placeholders for an empty voice", () => {
    const diagnostics = analyzeVoiceDiagnostics(project([], [voice("voice-1", "Empty", 0, 0)]));

    expect(diagnostics[0]).toMatchObject({
      noteCount: 0,
      minPitch: 0,
      maxPitch: 0,
      pitchSpan: 0,
      suspicious: false,
    });
  });
});

describe("diagnostic display helpers", () => {
  it("returns note ids for a selected voice in project order", () => {
    const notes = [
      note("a", "voice-1", 60, 0),
      note("b", "voice-2", 72, 0),
      note("c", "voice-1", 64, 120),
    ];

    expect(noteIdsForVoice(notes, "voice-1")).toEqual(["a", "c"]);
  });

  it("returns flagged note ids for one voice in project order", () => {
    const notes = [
      note("clean", "voice-1", 60, 0),
      note("low", "voice-1", 62, 120, { assignmentConfidence: 0.2 }),
      note("other", "voice-2", 64, 240, { assignmentConfidence: 0.1 }),
      note("cap", "voice-1", 65, 360, { assignmentReason: "VOICE_CAP_REACHED" }),
    ];

    expect(flaggedNoteIdsForVoice(notes, "voice-1")).toEqual(["low", "cap"]);
  });
  it("sorts suspicious voices before clean ones", () => {
    const diagnostics = analyzeVoiceDiagnostics(
      project(
        [note("a", "voice-1", 60, 0), note("b", "voice-2", 20, 0), note("c", "voice-2", 80, 120)],
        [voice("voice-1", "Clean"), voice("voice-2", "Scattered")],
      ),
    );

    expect(
      sortVoiceDiagnosticsForDisplay(diagnostics).map((diagnostic) => diagnostic.label),
    ).toEqual(["Scattered", "Clean"]);
  });

  it("formats a compact summary line", () => {
    const diagnostic = analyzeVoiceDiagnostics(
      project([note("a", "voice-1", 40, 0), note("b", "voice-1", 80, 120)]),
    )[0];

    expect(formatVoiceDiagnosticSummary(diagnostic)).toBe(
      "Voice 1: 2 notes, span 40 semitones, 1 large leaps, 0 low-confidence notes",
    );
  });
  it("formats a compact channel distribution line", () => {
    const diagnostic = analyzeVoiceDiagnostics(
      project([
        note("a", "voice-1", 40, 0, { channel: 2 }),
        note("b", "voice-1", 42, 120, { channel: 2 }),
        note("c", "voice-1", 80, 240, { channel: 0 }),
      ]),
    )[0];

    expect(formatVoiceChannelDistribution(diagnostic)).toBe(
      "Channels: Channel 3: 2 (67%), Channel 1: 1 (33%)",
    );
  });
  it("formats split repair button labels with the chosen cutoff or channel", () => {
    const pitchRepair = buildSplitVoiceByPitchRepair(
      [note("low", "voice-1", 36, 0), note("high", "voice-1", 72, 120)],
      ["voice-1"],
      "voice-1",
    );
    const channelRepair = buildSplitVoiceByChannelRepair(
      [
        note("lead-a", "voice-1", 72, 0, { channel: 2 }),
        note("lead-b", "voice-1", 74, 120, { channel: 2 }),
        note("bass", "voice-1", 40, 240, { channel: 0 }),
      ],
      ["voice-1"],
      "voice-1",
    );

    expect(pitchRepair && formatSplitVoiceByPitchRepairLabel(pitchRepair)).toBe(
      "Split above C2 (1 note)",
    );
    expect(channelRepair && formatSplitVoiceByChannelRepairLabel(channelRepair)).toBe(
      "Split Channel 1 (1 note)",
    );
  });
  it("formats the per-voice flagged-note review label", () => {
    expect(formatVoiceFlaggedReviewLabel(["a"])).toBe("Review flagged (1 note)");
    expect(formatVoiceFlaggedReviewLabel(["a", "b"])).toBe("Review flagged (2 notes)");
  });
});

describe("recommendSeparationAction", () => {
  it("warns when max polyphony is much higher than the selected cap", () => {
    const fixture = project([
      note("a", "voice-1", 60, 0),
      note("b", "voice-2", 64, 0),
      note("c", "voice-3", 67, 0),
      note("d", "voice-4", 72, 0),
    ]);

    expect(recommendSeparationAction(fixture, [], 2).message).toContain(
      "well above the selected cap of 2",
    );
  });

  it("recommends register-focused settings when one channel dominates", () => {
    const notes = [
      note("a", "voice-1", 60, 0, { channel: 0 }),
      note("b", "voice-1", 62, 120, { channel: 0 }),
      note("c", "voice-1", 64, 240, { channel: 0 }),
      note("d", "voice-1", 65, 360, { channel: 1 }),
    ];

    expect(recommendSeparationAction(project(notes), [], undefined).message).toContain(
      "Global + Register priority",
    );
  });

  it("recommends channel-priority settings when channels are cleanly distributed", () => {
    const notes = [
      note("a", "voice-1", 60, 0, { channel: 0 }),
      note("b", "voice-2", 72, 0, { channel: 1 }),
      note("c", "voice-1", 62, 120, { channel: 0 }),
      note("d", "voice-2", 74, 120, { channel: 1 }),
    ];

    expect(recommendSeparationAction(project(notes), [], undefined).message).toContain(
      "Strict channel",
    );
  });

  it("recommends pitch-range repair when multiple suspicious voices are wide", () => {
    const diagnostics = analyzeVoiceDiagnostics(
      project(
        [
          note("a", "voice-1", 20, 0),
          note("b", "voice-1", 80, 120),
          note("c", "voice-2", 30, 0),
          note("d", "voice-2", 90, 120),
        ],
        [voice("voice-1", "Voice 1"), voice("voice-2", "Voice 2")],
      ),
    );

    const fixture = project(
      [
        note("a", "voice-1", 20, 0, { channel: 0 }),
        note("b", "voice-1", 80, 120, { channel: 1 }),
        note("c", "voice-2", 30, 240, { channel: 2 }),
        note("d", "voice-2", 90, 360, { channel: 3 }),
      ],
      [voice("voice-1", "Voice 1"), voice("voice-2", "Voice 2")],
    );

    expect(recommendSeparationAction(fixture, diagnostics, undefined).message).toContain(
      "apply pitch ranges",
    );
  });
});

describe("buildSplitVoiceByPitchRepair", () => {
  it("moves notes above the selected pitch gap into a new voice and appends it to voice order", () => {
    const repair = buildSplitVoiceByPitchRepair(
      [
        note("low", "voice-1", 40, 0),
        note("mid", "voice-1", 60, 120),
        note("high", "voice-1", 80, 240),
        note("other", "voice-2", 90, 0),
      ],
      ["voice-1", "voice-2"],
      "voice-1",
    );

    expect(repair).toEqual({
      sourceVoiceId: "voice-1",
      newVoiceId: "voice-3",
      threshold: 60,
      overrides: { high: "voice-3" },
      movedNoteIds: ["high"],
      voiceOrder: ["voice-1", "voice-2", "voice-3"],
    });
  });

  it("uses the largest pitch gap instead of the numeric midpoint by default", () => {
    const repair = buildSplitVoiceByPitchRepair(
      [
        note("bass", "voice-1", 20, 0),
        note("lead-a", "voice-1", 60, 120),
        note("lead-b", "voice-1", 62, 240),
        note("lead-c", "voice-1", 64, 360),
        note("accent", "voice-1", 90, 480),
      ],
      ["voice-1"],
      "voice-1",
    );

    expect(repair?.threshold).toBe(20);
    expect(repair?.movedNoteIds).toEqual(["lead-a", "lead-b", "lead-c", "accent"]);
  });

  it("accepts an explicit split threshold", () => {
    const repair = buildSplitVoiceByPitchRepair(
      [note("a", "voice-1", 40, 0), note("b", "voice-1", 70, 120)],
      ["voice-1"],
      "voice-1",
      50,
    );

    expect(repair?.overrides).toEqual({ b: "voice-2" });
    expect(repair?.threshold).toBe(50);
  });

  it("returns null when the split would move no notes or all notes", () => {
    const notes = [note("a", "voice-1", 40, 0), note("b", "voice-1", 41, 120)];

    expect(buildSplitVoiceByPitchRepair(notes, ["voice-1"], "voice-1", 90)).toBeNull();
    expect(buildSplitVoiceByPitchRepair(notes, ["voice-1"], "voice-1", 10)).toBeNull();
  });
});

describe("buildSplitVoiceByChannelRepair", () => {
  it("moves the largest non-dominant channel into a new voice", () => {
    const repair = buildSplitVoiceByChannelRepair(
      [
        note("lead-a", "voice-1", 72, 0, { channel: 2 }),
        note("bass-a", "voice-1", 40, 120, { channel: 0 }),
        note("lead-b", "voice-1", 74, 240, { channel: 2 }),
        note("lead-c", "voice-1", 76, 300, { channel: 2 }),
        note("bass-b", "voice-1", 43, 360, { channel: 0 }),
        note("ornament", "voice-1", 80, 480, { channel: 1 }),
        note("other", "voice-2", 60, 0, { channel: 0 }),
      ],
      ["voice-1", "voice-2"],
      "voice-1",
    );

    expect(repair).toEqual({
      sourceVoiceId: "voice-1",
      newVoiceId: "voice-3",
      movedChannel: 0,
      overrides: { "bass-a": "voice-3", "bass-b": "voice-3" },
      movedNoteIds: ["bass-a", "bass-b"],
      voiceOrder: ["voice-1", "voice-2", "voice-3"],
    });
  });

  it("returns null when the source voice uses only one channel", () => {
    const repair = buildSplitVoiceByChannelRepair(
      [note("a", "voice-1", 60, 0, { channel: 0 }), note("b", "voice-1", 64, 120, { channel: 0 })],
      ["voice-1"],
      "voice-1",
    );

    expect(repair).toBeNull();
  });
});

describe("maxSimultaneousPolyphony", () => {
  it("counts overlapping notes and treats zero-length notes as one tick", () => {
    const notes = [
      note("a", "voice-1", 60, 0, { endTick: 100 }),
      note("b", "voice-2", 64, 50, { endTick: 150 }),
      note("c", "voice-3", 67, 75, { endTick: 75 }),
    ];

    expect(maxSimultaneousPolyphony(notes)).toBe(3);
  });
});
