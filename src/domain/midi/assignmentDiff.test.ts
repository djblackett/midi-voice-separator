import { describe, expect, it } from "vitest";
import type { MidiNote, MidiVoice } from "./midiProject";
import {
  compareAssignments,
  diffAssignments,
  formatConfidenceDelta,
  formatOnlyInOneSideSummary,
  formatPercussionDelta,
  matchVoices,
  toDiffSide,
  type AssignmentDiff,
  type DiffRerunSettings,
  type DiffSide,
} from "./assignmentDiff";
import { PERCUSSION_VOICE_ID } from "./voiceManagement";

function note(
  id: string,
  voiceId: string,
  overrides: Partial<MidiNote> = {},
  startTick = 0,
): MidiNote {
  return {
    id,
    voiceId,
    sourceTrackIndex: 0,
    channel: 0,
    pitch: 60,
    velocity: 100,
    startTick,
    endTick: startTick + 120,
    durationTicks: 120,
    assignmentConfidence: 1,
    assignmentReason: "CLOSEST_PITCH",
    ...overrides,
  };
}

function voice(id: string, label: string): MidiVoice {
  return { id, label, noteCount: 1, lowestPitch: 60, highestPitch: 60 };
}

const balancedGreedy: DiffRerunSettings = {
  strategy: "BALANCED",
  assignmentMode: "GREEDY",
  maxVoiceCount: null,
};
const balancedGreedyProvenance = {
  kind: "reassigned" as const,
  strategy: "BALANCED" as const,
  mode: "GREEDY" as const,
  maxVoiceCount: null,
  algorithmVersion: 1,
};

/** Directly encodes assignments from each note's own voiceId, bypassing
 * override composition (that plumbing is toDiffSide's job, tested below). */
function side(
  notes: MidiNote[],
  voices: MidiVoice[],
  options: { lockedNoteIds?: readonly string[]; rerunSettings?: DiffRerunSettings } = {},
): DiffSide {
  return {
    notes,
    voices,
    assignments: new Map(notes.map((n) => [n.id, n.voiceId])),
    lockedNoteIds: new Set(options.lockedNoteIds ?? []),
    rerunSettings: options.rerunSettings ?? balancedGreedy,
  };
}

describe("matchVoices", () => {
  it("pairs voices by maximum note overlap, not by matching ids", () => {
    const before = side(
      [note("a", "voice-1"), note("b", "voice-1"), note("c", "voice-2"), note("d", "voice-2")],
      [voice("voice-1", "Voice 1"), voice("voice-2", "Voice 2")],
    );
    // Same grouping, entirely different (renamed) voice ids -- this is
    // exactly what a full re-run produces.
    const after = side(
      [note("a", "voice-9"), note("b", "voice-9"), note("c", "voice-7"), note("d", "voice-7")],
      [voice("voice-9", "Voice 1"), voice("voice-7", "Voice 2")],
    );

    const matching = matchVoices(before, after);

    expect(matching.matched).toEqual([
      { beforeVoiceId: "voice-1", afterVoiceId: "voice-9" },
      { beforeVoiceId: "voice-2", afterVoiceId: "voice-7" },
    ]);
    expect(matching.addedVoiceIds).toEqual([]);
    expect(matching.removedVoiceIds).toEqual([]);
  });

  it("reports unmatched voices as added/removed", () => {
    const before = side(
      [note("a", "voice-1")],
      [voice("voice-1", "Voice 1"), voice("voice-2", "Empty")],
    );
    const after = side(
      [note("a", "voice-1"), note("b", "voice-3")],
      [voice("voice-1", "Voice 1"), voice("voice-3", "New voice")],
    );

    const matching = matchVoices(before, after);

    expect(matching.matched).toEqual([{ beforeVoiceId: "voice-1", afterVoiceId: "voice-1" }]);
    expect(matching.removedVoiceIds).toEqual(["voice-2"]);
    expect(matching.addedVoiceIds).toEqual(["voice-3"]);
  });

  it("pre-matches the percussion voice to itself when present on both sides", () => {
    const before = side(
      [note("a", "voice-1"), note("p", PERCUSSION_VOICE_ID)],
      [voice("voice-1", "Voice 1"), voice(PERCUSSION_VOICE_ID, "Percussion")],
    );
    const after = side(
      [note("a", "voice-8"), note("p", PERCUSSION_VOICE_ID)],
      [voice("voice-8", "Voice 1"), voice(PERCUSSION_VOICE_ID, "Percussion")],
    );

    const matching = matchVoices(before, after);

    expect(matching.matched).toContainEqual({
      beforeVoiceId: PERCUSSION_VOICE_ID,
      afterVoiceId: PERCUSSION_VOICE_ID,
    });
  });

  it("excludes percussion entirely (never added/removed) when present on only one side", () => {
    const before = side(
      [note("a", "voice-1"), note("p", PERCUSSION_VOICE_ID)],
      [voice("voice-1", "Voice 1"), voice(PERCUSSION_VOICE_ID, "Percussion")],
    );
    const after = side([note("a", "voice-1")], [voice("voice-1", "Voice 1")]);

    const matching = matchVoices(before, after);

    expect(matching.matched.some((m) => m.beforeVoiceId === PERCUSSION_VOICE_ID)).toBe(false);
    expect(matching.removedVoiceIds).not.toContain(PERCUSSION_VOICE_ID);
    expect(matching.addedVoiceIds).not.toContain(PERCUSSION_VOICE_ID);
  });
});

describe("compareAssignments", () => {
  it("reports zero reassignments for a pure voice-id permutation", () => {
    const before = side(
      [note("a", "voice-1"), note("b", "voice-2")],
      [voice("voice-1", "V1"), voice("voice-2", "V2")],
    );
    const after = side(
      [note("a", "voice-9"), note("b", "voice-7")],
      [voice("voice-9", "V1"), voice("voice-7", "V2")],
    );

    const diff = compareAssignments(before, after, matchVoices(before, after)) as AssignmentDiff;

    expect(diff.changedNoteIds).toEqual([]);
  });

  it("reports a note that moved between two matched voices as changed", () => {
    // voice-2 keeps 3 of its own notes (b, c, d) so its self-overlap (3)
    // unambiguously beats the 1-note overlap voice-1 gets by "a" moving in
    // -- an unambiguous majority, not a tie a greedy matcher could break
    // either way.
    const before = side(
      [note("a", "voice-1"), note("b", "voice-2"), note("c", "voice-2"), note("d", "voice-2")],
      [voice("voice-1", "V1"), voice("voice-2", "V2")],
    );
    const after = side(
      [note("a", "voice-2"), note("b", "voice-2"), note("c", "voice-2"), note("d", "voice-2")],
      [voice("voice-1", "V1 (now empty)"), voice("voice-2", "V2")],
    );

    const diff = compareAssignments(before, after, matchVoices(before, after)) as AssignmentDiff;

    expect(diff.changedNoteIds).toEqual(["a"]);
  });

  it("counts notes present on only one side separately from reassignments", () => {
    const before = side([note("a", "voice-1"), note("gone", "voice-1")], [voice("voice-1", "V1")]);
    const after = side([note("a", "voice-1"), note("new", "voice-1")], [voice("voice-1", "V1")]);

    const diff = compareAssignments(before, after, matchVoices(before, after)) as AssignmentDiff;

    expect(diff.changedNoteIds).toEqual([]);
    expect(diff.onlyInBeforeNoteIds).toEqual(["gone"]);
    expect(diff.onlyInAfterNoteIds).toEqual(["new"]);
  });

  it("reports label changes only for matched voice pairs", () => {
    const before = side([note("a", "voice-1")], [voice("voice-1", "Lead")]);
    const after = side([note("a", "voice-1")], [voice("voice-1", "Melody")]);

    const diff = compareAssignments(before, after, matchVoices(before, after)) as AssignmentDiff;

    expect(diff.changedVoiceLabels).toEqual([
      {
        beforeVoiceId: "voice-1",
        afterVoiceId: "voice-1",
        beforeLabel: "Lead",
        afterLabel: "Melody",
      },
    ]);
  });

  it("counts a lock as preserved only if the note stayed in its matched voice", () => {
    const before = side(
      [
        note("locked-stays", "voice-1"),
        note("locked-moves", "voice-1"),
        note("unlocked", "voice-1"),
      ],
      [voice("voice-1", "V1"), voice("voice-2", "V2")],
      { lockedNoteIds: ["locked-stays", "locked-moves"] },
    );
    const after = side(
      [
        note("locked-stays", "voice-1"),
        note("locked-moves", "voice-2"),
        note("unlocked", "voice-1"),
      ],
      [voice("voice-1", "V1"), voice("voice-2", "V2")],
      { lockedNoteIds: ["locked-stays", "locked-moves"] },
    );

    const diff = compareAssignments(before, after, matchVoices(before, after)) as AssignmentDiff;

    expect(diff.locksPreservedCount).toBe(1);
  });

  it("does not count a lock as preserved if it was dropped on the after side", () => {
    const before = side([note("a", "voice-1")], [voice("voice-1", "V1")], {
      lockedNoteIds: ["a"],
    });
    const after = side([note("a", "voice-1")], [voice("voice-1", "V1")], { lockedNoteIds: [] });

    const diff = compareAssignments(before, after, matchVoices(before, after)) as AssignmentDiff;

    expect(diff.locksPreservedCount).toBe(0);
  });

  it("reports percussion counts via percussionDelta, not as per-note reassignments", () => {
    // p2 moves out of percussion into voice-1 on the after side -- present
    // on both sides throughout, so this exercises the percussion-skip
    // branch in the per-note loop, not the only-in-one-side path.
    const before = side(
      [note("a", "voice-1"), note("p1", PERCUSSION_VOICE_ID), note("p2", PERCUSSION_VOICE_ID)],
      [voice("voice-1", "V1"), voice(PERCUSSION_VOICE_ID, "Percussion")],
    );
    const after = side(
      [note("a", "voice-1"), note("p1", PERCUSSION_VOICE_ID), note("p2", "voice-1")],
      [voice("voice-1", "V1"), voice(PERCUSSION_VOICE_ID, "Percussion")],
    );

    const diff = compareAssignments(before, after, matchVoices(before, after)) as AssignmentDiff;

    expect(diff.percussionDelta).toEqual({ beforeCount: 2, afterCount: 1 });
    expect(diff.changedNoteIds).toEqual([]);
    expect(diff.onlyInBeforeNoteIds).toEqual([]);
  });

  it("is null when the percussion voice exists on neither side", () => {
    const before = side([note("a", "voice-1")], [voice("voice-1", "V1")]);
    const after = side([note("a", "voice-1")], [voice("voice-1", "V1")]);

    const diff = compareAssignments(before, after, matchVoices(before, after)) as AssignmentDiff;

    expect(diff.percussionDelta).toBeNull();
  });

  it("computes confidence improved/worsened when strategy and mode match (C5)", () => {
    const before = side(
      [
        note("improved", "voice-1", { assignmentConfidence: 0.2 }),
        note("worsened", "voice-1", { assignmentConfidence: 0.8 }),
        note("stable", "voice-1", { assignmentConfidence: 0.9 }),
      ],
      [voice("voice-1", "V1")],
      { rerunSettings: balancedGreedy },
    );
    const after = side(
      [
        note("improved", "voice-1", { assignmentConfidence: 0.9 }),
        note("worsened", "voice-1", { assignmentConfidence: 0.1 }),
        note("stable", "voice-1", { assignmentConfidence: 0.85 }),
      ],
      [voice("voice-1", "V1")],
      { rerunSettings: balancedGreedy },
    );

    const diff = compareAssignments(before, after, matchVoices(before, after)) as AssignmentDiff;

    expect(diff.confidenceComparable).toBe(true);
    expect(diff.confidence).toEqual({
      improvedNoteIds: ["improved"],
      worsenedNoteIds: ["worsened"],
    });
  });

  it("suppresses confidence comparison when strategy differs, even with real confidence deltas (C5)", () => {
    const before = side(
      [note("a", "voice-1", { assignmentConfidence: 0.9 })],
      [voice("voice-1", "V1")],
      { rerunSettings: { strategy: "BALANCED", assignmentMode: "GREEDY", maxVoiceCount: null } },
    );
    const after = side(
      [note("a", "voice-1", { assignmentConfidence: 0.1 })],
      [voice("voice-1", "V1")],
      {
        rerunSettings: {
          strategy: "REGISTER_PRIORITY",
          assignmentMode: "GREEDY",
          maxVoiceCount: null,
        },
      },
    );

    const diff = compareAssignments(before, after, matchVoices(before, after)) as AssignmentDiff;

    expect(diff.confidenceComparable).toBe(false);
    expect(diff.confidence).toBeNull();
  });

  it("suppresses confidence comparison when assignment mode differs (C5)", () => {
    const before = side(
      [note("a", "voice-1", { assignmentConfidence: 0.9 })],
      [voice("voice-1", "V1")],
      { rerunSettings: { strategy: "BALANCED", assignmentMode: "GREEDY", maxVoiceCount: null } },
    );
    const after = side(
      [note("a", "voice-1", { assignmentConfidence: 0.1 })],
      [voice("voice-1", "V1")],
      { rerunSettings: { strategy: "BALANCED", assignmentMode: "GLOBAL", maxVoiceCount: null } },
    );

    const diff = compareAssignments(before, after, matchVoices(before, after)) as AssignmentDiff;

    expect(diff.confidenceComparable).toBe(false);
    expect(diff.confidence).toBeNull();
  });
});

describe("diffAssignments", () => {
  it("refuses to compare two (near-)disjoint note-id sets", () => {
    const before = side(
      [note("a", "voice-1"), note("b", "voice-1"), note("c", "voice-1"), note("d", "voice-1")],
      [voice("voice-1", "V1")],
    );
    // Simulates comparing against a reimported project: ids regenerated,
    // only one happens to coincide.
    const after = side(
      [note("a", "voice-1"), note("x", "voice-1"), note("y", "voice-1"), note("z", "voice-1")],
      [voice("voice-1", "V1")],
    );

    const result = diffAssignments(before, after);

    expect(result.comparable).toBe(false);
    if (!result.comparable) {
      expect(result.reason).toMatch(/different imports/i);
    }
  });

  it("returns a full diff when enough notes are shared", () => {
    const before = side([note("a", "voice-1"), note("b", "voice-1")], [voice("voice-1", "V1")]);
    const after = side([note("a", "voice-1"), note("b", "voice-2")], [voice("voice-2", "V1")]);

    const result = diffAssignments(before, after);

    expect(result.comparable).toBe(true);
  });
});

describe("toDiffSide", () => {
  it("returns null when there is no project", () => {
    expect(
      toDiffSide(
        { project: null, voiceOverrides: {}, voiceOrder: [], voiceLabels: {} },
        balancedGreedyProvenance,
      ),
    ).toBeNull();
  });

  it("materializes overrides and rebuilds voices from voiceOrder/voiceLabels", () => {
    const project = {
      fileName: "f.mid",
      format: "parallel",
      ppq: 480,
      durationTicks: 480,
      trackCount: 1,
      voices: [voice("voice-1", "Voice 1")],
      notes: [note("a", "voice-1"), note("b", "voice-1")],
      tempoChanges: [],
      timeSignatures: [],
      warnings: [],
      separationSummary: { meanConfidence: 1, lowConfidenceNoteCount: 0, voiceCount: 1 },
      strategySuggestion: { strategy: "BALANCED" as const, reason: "fixture" },
    };

    const result = toDiffSide(
      {
        project,
        voiceOverrides: { b: "voice-2" },
        voiceOrder: ["voice-1", "voice-2"],
        voiceLabels: { "voice-2": "New voice" },
      },
      balancedGreedyProvenance,
    );

    expect(result?.assignments.get("a")).toBe("voice-1");
    expect(result?.assignments.get("b")).toBe("voice-2");
    expect(result?.voices.map((v) => v.id)).toEqual(["voice-1", "voice-2"]);
    expect(result?.voices.find((v) => v.id === "voice-2")?.label).toBe("New voice");
    expect(result?.lockedNoteIds.has("b")).toBe(true);
  });
});

describe("formatOnlyInOneSideSummary", () => {
  function diffWith(onlyInBefore: string[], onlyInAfter: string[]): AssignmentDiff {
    return {
      comparable: true,
      changedNoteIds: [],
      onlyInBeforeNoteIds: onlyInBefore,
      onlyInAfterNoteIds: onlyInAfter,
      addedVoiceIds: [],
      removedVoiceIds: [],
      changedVoiceLabels: [],
      locksPreservedCount: 0,
      percussionDelta: null,
      confidenceComparable: true,
      confidence: { improvedNoteIds: [], worsenedNoteIds: [] },
    };
  }

  it("returns null when every note is shared", () => {
    expect(formatOnlyInOneSideSummary(diffWith([], []))).toBeNull();
  });

  it("reports both counts when notes exist on only one side each", () => {
    expect(formatOnlyInOneSideSummary(diffWith(["a"], ["b", "c"]))).toBe(
      "1 only in the earlier state, 2 only in the current state.",
    );
  });
});

describe("formatPercussionDelta", () => {
  it("reports 'unchanged' when the count didn't move", () => {
    expect(formatPercussionDelta({ beforeCount: 5, afterCount: 5 })).toBe(
      "5 percussion notes (unchanged).",
    );
  });

  it("shows the before -> after arrow when the count changed", () => {
    expect(formatPercussionDelta({ beforeCount: 5, afterCount: 3 })).toBe(
      "Percussion notes: 5 → 3.",
    );
  });
});

describe("formatConfidenceDelta", () => {
  function diffWith(overrides: Partial<AssignmentDiff>): AssignmentDiff {
    return {
      comparable: true,
      changedNoteIds: [],
      onlyInBeforeNoteIds: [],
      onlyInAfterNoteIds: [],
      addedVoiceIds: [],
      removedVoiceIds: [],
      changedVoiceLabels: [],
      locksPreservedCount: 0,
      percussionDelta: null,
      confidenceComparable: true,
      confidence: { improvedNoteIds: [], worsenedNoteIds: [] },
      ...overrides,
    };
  }

  it("explains why when not comparable, regardless of confidence contents", () => {
    expect(formatConfidenceDelta(diffWith({ confidenceComparable: false, confidence: null }))).toBe(
      "Not comparable — the two sides have different assignment provenance.",
    );
  });

  it("reports 'no change' when comparable but nothing crossed the threshold", () => {
    expect(formatConfidenceDelta(diffWith({}))).toBe("No confidence change.");
  });

  it("reports both improved and worsened counts when comparable", () => {
    expect(
      formatConfidenceDelta(
        diffWith({
          confidence: { improvedNoteIds: ["a", "b"], worsenedNoteIds: ["c"] },
        }),
      ),
    ).toBe("2 improved, 1 worsened.");
  });
});
