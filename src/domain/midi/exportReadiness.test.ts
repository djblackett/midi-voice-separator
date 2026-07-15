import { describe, expect, it } from "vitest";
import type { AssignmentDiff } from "./assignmentDiff";
import {
  buildExportReadinessSummary,
  formatExportReadinessStatus,
  type ExportReadinessSummary,
} from "./exportReadiness";
import type { MidiProject, MidiVoice } from "./midiProject";

function voice(overrides: Partial<MidiVoice> = {}): MidiVoice {
  return {
    id: "voice-1",
    label: "Lead",
    noteCount: 12,
    lowestPitch: 48,
    highestPitch: 72,
    ...overrides,
  };
}

function project(voices: readonly MidiVoice[]): Pick<MidiProject, "notes" | "voices"> {
  return { notes: [], voices: [...voices] };
}

function diffWithChangedNotes(changedNoteIds: readonly string[]): AssignmentDiff {
  return {
    comparable: true,
    changedNoteIds,
    onlyInBeforeNoteIds: [],
    onlyInAfterNoteIds: [],
    addedVoiceIds: [],
    removedVoiceIds: [],
    changedVoiceLabels: [],
    locksPreservedCount: 0,
    percussionDelta: null,
    confidenceComparable: true,
    confidence: { improvedNoteIds: [], worsenedNoteIds: [] },
  };
}

describe("buildExportReadinessSummary", () => {
  it("returns no findings when there is no project", () => {
    expect(
      buildExportReadinessSummary({
        project: null,
        reviewProgress: { flaggedCount: 0, reviewedCount: 0, remainingCount: 0 },
        baselineDiff: null,
        lockedNoteIds: new Set(),
      }),
    ).toEqual({ status: "ok", findings: [] });
  });

  it("reports unresolved flagged notes from the derived review progress", () => {
    const summary = buildExportReadinessSummary({
      project: project([voice()]),
      reviewProgress: { flaggedCount: 4, reviewedCount: 2, remainingCount: 2 },
      baselineDiff: null,
      lockedNoteIds: new Set(),
    });

    expect(summary.status).toBe("warning");
    expect(summary.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "unresolved-flagged-notes",
          severity: "warning",
          detail: "2 flagged notes still need review.",
        }),
      ]),
    );
  });

  it("reports generic, empty, and tiny voices without blocking export", () => {
    const summary = buildExportReadinessSummary({
      project: project([
        voice({ id: "voice-1", label: "Voice 1", noteCount: 10 }),
        voice({ id: "voice-2", label: "Empty", noteCount: 0 }),
        voice({ id: "voice-3", label: "Blip", noteCount: 1 }),
      ]),
      reviewProgress: { flaggedCount: 0, reviewedCount: 0, remainingCount: 0 },
      baselineDiff: null,
      lockedNoteIds: new Set(),
    });

    expect(summary.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "generic-voice-labels", severity: "warning" }),
        expect.objectContaining({ id: "empty-voices", severity: "warning" }),
        expect.objectContaining({ id: "tiny-voices", severity: "warning" }),
      ]),
    );
  });

  it("reports changed baseline notes that are not locked", () => {
    const summary = buildExportReadinessSummary({
      project: project([voice()]),
      reviewProgress: { flaggedCount: 0, reviewedCount: 0, remainingCount: 0 },
      baselineDiff: diffWithChangedNotes(["locked", "unlocked"]),
      lockedNoteIds: new Set(["locked"]),
    });

    expect(summary.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "unlocked-changed-notes",
          detail: "1 changed note is not locked against the selected baseline.",
        }),
      ]),
    );
  });

  it("reports same-voice overlapping notes", () => {
    const overlappingNotes = [
      {
        id: "a",
        voiceId: "voice-1",
        sourceTrackIndex: 0,
        channel: 0,
        pitch: 60,
        velocity: 80,
        startTick: 0,
        endTick: 600,
        durationTicks: 600,
        assignmentConfidence: 1,
        assignmentReason: "IMPORTED" as const,
      },
      {
        id: "b",
        voiceId: "voice-1",
        sourceTrackIndex: 0,
        channel: 0,
        pitch: 64,
        velocity: 80,
        startTick: 480,
        endTick: 960,
        durationTicks: 480,
        assignmentConfidence: 1,
        assignmentReason: "IMPORTED" as const,
      },
    ];
    const summary = buildExportReadinessSummary({
      project: { notes: overlappingNotes, voices: [voice()] },
      reviewProgress: { flaggedCount: 0, reviewedCount: 0, remainingCount: 0 },
      baselineDiff: null,
      lockedNoteIds: new Set(),
    });

    expect(summary.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "overlapping-notes",
          severity: "warning",
          detail: "1 same-voice overlap — monophonic chiptune voices can't play two notes at once.",
        }),
      ]),
    );
  });

  it("includes percussion and manual reimport reminders as informational findings", () => {
    const summary = buildExportReadinessSummary({
      project: project([voice({ id: "percussion", label: "Percussion", noteCount: 3 })]),
      reviewProgress: { flaggedCount: 0, reviewedCount: 0, remainingCount: 0 },
      baselineDiff: null,
      lockedNoteIds: new Set(),
    });

    expect(summary.status).toBe("info");
    expect(summary.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "percussion-present", severity: "info" }),
        expect.objectContaining({ id: "manual-reimport-check", severity: "info" }),
      ]),
    );
  });

  it("removes the pre-export manual reminder once the exact revision has a verification report", () => {
    const summary = buildExportReadinessSummary({
      project: project([]),
      reviewProgress: { flaggedCount: 0, reviewedCount: 0, remainingCount: 0 },
      baselineDiff: null,
      lockedNoteIds: new Set(),
      hasCurrentVerification: true,
    });

    expect(summary.findings).not.toContainEqual(
      expect.objectContaining({ id: "manual-reimport-check" }),
    );
    expect(formatExportReadinessStatus(summary)).toBe("Export readiness: no blocking checks.");
  });
});

describe("formatExportReadinessStatus", () => {
  it("summarizes warning counts", () => {
    const summary: ExportReadinessSummary = {
      status: "warning",
      findings: [
        { id: "a", severity: "warning", label: "A", detail: "A" },
        { id: "b", severity: "warning", label: "B", detail: "B" },
        { id: "c", severity: "info", label: "C", detail: "C" },
      ],
    };

    expect(formatExportReadinessStatus(summary)).toBe(
      "Export readiness: 2 advisory checks to review before export.",
    );
  });

  it("states when only informational reminders remain", () => {
    expect(
      formatExportReadinessStatus({
        status: "info",
        findings: [
          {
            id: "manual-reimport-check",
            severity: "info",
            label: "Round trip",
            detail: "Manual reimport reminder",
          },
        ],
      }),
    ).toBe(
      "Export readiness: no blocking checks. Review the manual reimport reminder after export.",
    );
  });
});
