import type { AssignmentDiff } from "./assignmentDiff";
import type { MidiProject, MidiVoice } from "./midiProject";
import type { ReviewProgress } from "./reviewQueue";
import { findVoiceConflicts } from "./voiceConflicts";
import { PERCUSSION_VOICE_ID } from "./voiceManagement";

export type ExportReadinessSeverity = "ok" | "info" | "warning";

export interface ExportReadinessFinding {
  id: string;
  severity: ExportReadinessSeverity;
  label: string;
  detail: string;
}

export interface ExportReadinessSummary {
  status: ExportReadinessSeverity;
  findings: readonly ExportReadinessFinding[];
}

export interface ExportReadinessInput {
  project: Pick<MidiProject, "notes" | "voices"> | null;
  reviewProgress: ReviewProgress;
  baselineDiff: AssignmentDiff | null;
  lockedNoteIds: ReadonlySet<string>;
}

function isGenericVoiceLabel(voice: MidiVoice, index: number): boolean {
  return voice.label === `Voice ${index + 1}`;
}

function voiceLabelList(voices: readonly MidiVoice[]): string {
  return voices.map((voice) => voice.label).join(", ");
}

function countUnlockedChangedNotes(
  baselineDiff: AssignmentDiff | null,
  lockedNoteIds: ReadonlySet<string>,
): number {
  if (!baselineDiff) {
    return 0;
  }

  return baselineDiff.changedNoteIds.filter((noteId) => !lockedNoteIds.has(noteId)).length;
}

function highestSeverity(findings: readonly ExportReadinessFinding[]): ExportReadinessSeverity {
  return findings.some((finding) => finding.severity === "warning") ? "warning" : "info";
}

export function buildExportReadinessSummary({
  project,
  reviewProgress,
  baselineDiff,
  lockedNoteIds,
}: ExportReadinessInput): ExportReadinessSummary {
  if (!project) {
    return { status: "ok", findings: [] };
  }

  const findings: ExportReadinessFinding[] = [];
  if (reviewProgress.remainingCount > 0) {
    findings.push({
      id: "unresolved-flagged-notes",
      severity: "warning",
      label: "Flagged review",
      detail: `${reviewProgress.remainingCount} flagged note${reviewProgress.remainingCount === 1 ? "" : "s"} still need review.`,
    });
  }

  const genericVoices = project.voices.filter(isGenericVoiceLabel);
  if (genericVoices.length > 0) {
    findings.push({
      id: "generic-voice-labels",
      severity: "warning",
      label: "Voice labels",
      detail: `${genericVoices.length} voice${genericVoices.length === 1 ? "" : "s"} still use generic labels: ${voiceLabelList(genericVoices)}.`,
    });
  }

  const emptyVoices = project.voices.filter((voice) => voice.noteCount === 0);
  if (emptyVoices.length > 0) {
    findings.push({
      id: "empty-voices",
      severity: "warning",
      label: "Empty voices",
      detail: `${emptyVoices.length} voice${emptyVoices.length === 1 ? " has" : "s have"} no notes: ${voiceLabelList(emptyVoices)}.`,
    });
  }

  const tinyVoices = project.voices.filter((voice) => voice.noteCount > 0 && voice.noteCount <= 1);
  if (tinyVoices.length > 0) {
    findings.push({
      id: "tiny-voices",
      severity: "warning",
      label: "Tiny voices",
      detail: `${tinyVoices.length} voice${tinyVoices.length === 1 ? " has" : "s have"} only one note: ${voiceLabelList(tinyVoices)}.`,
    });
  }

  const overlapConflicts = findVoiceConflicts(project.notes);
  if (overlapConflicts.length > 0) {
    findings.push({
      id: "overlapping-notes",
      severity: "warning",
      label: "Overlapping notes",
      detail: `${overlapConflicts.length} same-voice overlap${overlapConflicts.length === 1 ? "" : "s"} — monophonic chiptune voices can't play two notes at once.`,
    });
  }

  const unlockedChangedNoteCount = countUnlockedChangedNotes(baselineDiff, lockedNoteIds);
  if (unlockedChangedNoteCount > 0) {
    findings.push({
      id: "unlocked-changed-notes",
      severity: "warning",
      label: "Changed notes",
      detail: `${unlockedChangedNoteCount} changed note${unlockedChangedNoteCount === 1 ? " is" : "s are"} not locked against the selected baseline.`,
    });
  }

  const percussionVoice = project.voices.find((voice) => voice.id === PERCUSSION_VOICE_ID);
  if (percussionVoice) {
    findings.push({
      id: "percussion-present",
      severity: "info",
      label: "Percussion",
      detail: `${percussionVoice.noteCount} note${percussionVoice.noteCount === 1 ? "" : "s"} will export to the percussion voice.`,
    });
  }

  findings.push({
    id: "manual-reimport-check",
    severity: "info",
    label: "Round trip",
    detail:
      "After export, reimport the MIDI manually to confirm track layout and note identity by ear/inspection.",
  });

  return {
    status: findings.length > 0 ? highestSeverity(findings) : "ok",
    findings,
  };
}

export function formatExportReadinessStatus(summary: ExportReadinessSummary): string {
  const warningCount = summary.findings.filter((finding) => finding.severity === "warning").length;
  if (warningCount === 0) {
    return "Export readiness: no blocking checks. Review the manual reimport reminder after export.";
  }
  return `Export readiness: ${warningCount} advisory check${warningCount === 1 ? "" : "s"} to review before export.`;
}
