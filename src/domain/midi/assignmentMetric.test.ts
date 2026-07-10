import { describe, expect, it } from "vitest";
import type { MidiNote } from "./midiProject";
import {
  compareAssignmentModelCosts,
  haveSameAssignmentNoteUniverse,
  type AssignmentHardViolation,
  type AssignmentMetricReport,
  type AssignmentMetricSubject,
} from "./assignmentMetric";

function note(id: string, voiceId: string, startTick = 0, endTick = 480): MidiNote {
  return {
    id,
    voiceId,
    sourceTrackIndex: 0,
    channel: 0,
    pitch: 60,
    velocity: 100,
    startTick,
    endTick,
    durationTicks: endTick - startTick,
    assignmentConfidence: 1,
    assignmentReason: "IMPORTED",
  };
}

function subject(notes: MidiNote[] = [note("a", "voice-1")], ppq = 480): AssignmentMetricSubject {
  return { ppq, notes };
}

function report(
  totalCost: number,
  options: {
    metricVersion?: number;
    profileVersion?: number;
    melodicVoiceCount?: number;
    hardViolations?: AssignmentHardViolation[];
  } = {},
): AssignmentMetricReport {
  return {
    metric: { id: "ASSIGNMENT_MODEL_COST", version: options.metricVersion ?? 1 },
    profile: { id: "GENERAL_PURPOSE", version: options.profileVersion ?? 1 },
    melodicNoteCount: 1,
    excludedPercussionNoteCount: 0,
    melodicVoiceCount: options.melodicVoiceCount ?? 1,
    components: [],
    totalCost,
    hardViolations: options.hardViolations ?? [],
  };
}

const overlap: AssignmentHardViolation = {
  kind: "MELODIC_SAME_VOICE_OVERLAP",
  occurrenceCount: 1,
  affectedNoteIds: ["a", "b"],
};

describe("haveSameAssignmentNoteUniverse", () => {
  it("is note-order invariant and ignores assignment/reporting metadata", () => {
    const first = note("a", "voice-1", 0, 240);
    const second = note("b", "voice-2", 240, 480);
    const changed = [
      {
        ...second,
        voiceId: "renamed",
        assignmentConfidence: 0,
        assignmentReason: "USER_LOCKED" as const,
      },
      { ...first, voiceId: "other", sourceTrackIndex: 9 },
    ];
    expect(haveSameAssignmentNoteUniverse(subject([first, second]), subject(changed))).toBe(true);
  });

  it("compares musical timing as exact rational quarter-note positions", () => {
    expect(
      haveSameAssignmentNoteUniverse(
        subject([note("a", "voice-1", 120, 360)], 480),
        subject([note("a", "voice-9", 240, 720)], 960),
      ),
    ).toBe(true);
  });

  it("rejects changed content, percussion content, multiplicity, and invalid PPQ", () => {
    const base = note("a", "voice-1");
    expect(haveSameAssignmentNoteUniverse(subject([base]), subject([{ ...base, pitch: 61 }]))).toBe(
      false,
    );
    expect(
      haveSameAssignmentNoteUniverse(subject([base]), subject([{ ...base, channel: 9 }])),
    ).toBe(false);
    expect(haveSameAssignmentNoteUniverse(subject([base]), subject([base, { ...base }]))).toBe(
      false,
    );
    expect(haveSameAssignmentNoteUniverse(subject([base], 0), subject([base]))).toBe(false);
  });
});

describe("compareAssignmentModelCosts", () => {
  const target = subject();
  const current = subject([note("a", "renamed")]);

  it("reports the lower target, lower current, and exact tie", () => {
    expect(compareAssignmentModelCosts(target, current, report(10), report(12))).toEqual({
      status: "LOWER_TARGET",
      delta: 2,
    });
    expect(compareAssignmentModelCosts(target, current, report(12), report(10))).toEqual({
      status: "LOWER_CURRENT",
      delta: 2,
    });
    expect(compareAssignmentModelCosts(target, current, report(10), report(10))).toEqual({
      status: "TIED",
    });
  });

  it("suppresses a winner for metric or profile version mismatch", () => {
    expect(
      compareAssignmentModelCosts(target, current, report(10), report(12, { metricVersion: 2 })),
    ).toEqual({
      status: "UNSUPPORTED",
      reason: "METRIC_MISMATCH",
    });
    expect(
      compareAssignmentModelCosts(target, current, report(10), report(12, { profileVersion: 2 })),
    ).toEqual({
      status: "UNSUPPORTED",
      reason: "PROFILE_MISMATCH",
    });
  });

  it("suppresses a winner for a different note universe", () => {
    expect(
      compareAssignmentModelCosts(
        target,
        subject([note("different", "voice-1")]),
        report(10),
        report(12),
      ),
    ).toEqual({ status: "UNSUPPORTED", reason: "NOTE_UNIVERSE_MISMATCH" });
  });

  it("suppresses a winner when either or both assignments have hard violations", () => {
    for (const [targetViolations, currentViolations] of [
      [[overlap], []],
      [[], [overlap]],
      [[overlap], [overlap]],
    ] as const) {
      expect(
        compareAssignmentModelCosts(
          target,
          current,
          report(10, { hardViolations: [...targetViolations] }),
          report(12, { hardViolations: [...currentViolations] }),
        ),
      ).toEqual({ status: "UNSUPPORTED", reason: "HARD_VIOLATIONS" });
    }
  });

  it("suppresses a winner when distinct assigned melodic voice counts differ", () => {
    expect(
      compareAssignmentModelCosts(target, current, report(10), report(5, { melodicVoiceCount: 2 })),
    ).toEqual({ status: "UNSUPPORTED", reason: "MELODIC_VOICE_COUNT_MISMATCH" });
  });
});
