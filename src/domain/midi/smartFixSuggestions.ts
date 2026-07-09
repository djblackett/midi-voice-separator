import {
  LOW_CONFIDENCE_THRESHOLD,
  formatPitchName,
  type MidiNote,
  type MidiVoice,
} from "./midiProject";
import { PERCUSSION_VOICE_ID } from "./voiceManagement";

const LOW_CONFIDENCE_CLUSTER_WINDOW_TICKS = 960;
const PHRASE_GAP_TICKS = 480;
const PHRASE_MAX_PITCH_JUMP = 5;

export type SmartFixAction =
  | { type: "select"; noteIds: string[] }
  | { type: "assign"; noteIds: string[]; targetVoiceId: string }
  | { type: "merge"; sourceVoiceId: string; targetVoiceId: string };

export interface SmartFixSuggestion {
  id: string;
  title: string;
  reason: string;
  actionLabel: string;
  action: SmartFixAction;
}

export interface SmartFixInput {
  notes: readonly MidiNote[];
  voices: readonly MidiVoice[];
  lockedNoteIds: ReadonlySet<string>;
}

function voiceLabel(voices: readonly MidiVoice[], voiceId: string): string {
  return voices.find((voice) => voice.id === voiceId)?.label ?? voiceId;
}

function notesByVoice(notes: readonly MidiNote[]): Map<string, MidiNote[]> {
  const grouped = new Map<string, MidiNote[]>();
  for (const note of notes) {
    const voiceNotes = grouped.get(note.voiceId) ?? [];
    voiceNotes.push(note);
    grouped.set(note.voiceId, voiceNotes);
  }
  return grouped;
}

function overlaps(left: MidiNote, right: MidiNote): boolean {
  return left.startTick < right.endTick && right.startTick < left.endTick;
}

function voiceCanReceiveAll(
  targetVoiceNotes: readonly MidiNote[],
  movedNotes: readonly MidiNote[],
): boolean {
  return movedNotes.every(
    (moved) => !targetVoiceNotes.some((candidate) => overlaps(candidate, moved)),
  );
}

function buildLowConfidenceClusterSuggestion({
  notes,
  lockedNoteIds,
}: SmartFixInput): SmartFixSuggestion | null {
  const flagged = notes
    .filter(
      (note) =>
        note.voiceId !== PERCUSSION_VOICE_ID &&
        !lockedNoteIds.has(note.id) &&
        note.assignmentConfidence < LOW_CONFIDENCE_THRESHOLD,
    )
    .sort((left, right) => left.startTick - right.startTick || left.pitch - right.pitch);

  let bestCluster: MidiNote[] = [];
  for (let start = 0; start < flagged.length; start += 1) {
    const clusterStart = flagged[start].startTick;
    const cluster = flagged.filter((note) => {
      const offset = note.startTick - clusterStart;
      return offset >= 0 && offset <= LOW_CONFIDENCE_CLUSTER_WINDOW_TICKS;
    });
    if (cluster.length > bestCluster.length) {
      bestCluster = cluster;
    }
  }

  if (bestCluster.length < 2) {
    return null;
  }

  const pitches = bestCluster.map((note) => note.pitch);
  return {
    id: `low-confidence-${bestCluster[0].id}`,
    title: `Review ${bestCluster.length} nearby low-confidence notes`,
    reason: `Cluster spans ticks ${bestCluster[0].startTick}-${bestCluster[bestCluster.length - 1].endTick} and pitches ${Math.min(...pitches)}-${Math.max(...pitches)}.`,
    actionLabel: "Select notes",
    action: { type: "select", noteIds: bestCluster.map((note) => note.id) },
  };
}

function buildTinyVoiceSuggestion({
  notes,
  voices,
  lockedNoteIds,
}: SmartFixInput): SmartFixSuggestion | null {
  const grouped = notesByVoice(notes);
  const tinyVoice = voices.find(
    (voice) =>
      voice.id !== PERCUSSION_VOICE_ID &&
      voice.noteCount > 0 &&
      voice.noteCount <= 1 &&
      (grouped.get(voice.id) ?? []).every((note) => !lockedNoteIds.has(note.id)),
  );
  if (!tinyVoice) {
    return null;
  }

  const tinyNotes = grouped.get(tinyVoice.id) ?? [];
  const tinyPitch = tinyNotes[0]?.pitch ?? tinyVoice.lowestPitch;
  const candidates = voices
    .filter((voice) => voice.id !== tinyVoice.id && voice.id !== PERCUSSION_VOICE_ID)
    .map((voice) => {
      const targetNotes = grouped.get(voice.id) ?? [];
      const centerPitch =
        targetNotes.length > 0
          ? targetNotes.reduce((sum, note) => sum + note.pitch, 0) / targetNotes.length
          : (voice.lowestPitch + voice.highestPitch) / 2;
      return {
        voice,
        distance: Math.abs(centerPitch - tinyPitch),
        canReceive: voiceCanReceiveAll(targetNotes, tinyNotes),
      };
    })
    .filter((candidate) => candidate.canReceive)
    .sort(
      (left, right) =>
        left.distance - right.distance || left.voice.id.localeCompare(right.voice.id),
    );

  const target = candidates[0]?.voice;
  if (!target) {
    return null;
  }

  return {
    id: `tiny-${tinyVoice.id}`,
    title: `Merge tiny voice into ${target.label}`,
    reason: `${tinyVoice.label} has ${tinyVoice.noteCount} note near ${formatPitchName(tinyPitch)} and can merge without creating same-voice overlap.`,
    actionLabel: "Merge voice",
    action: { type: "merge", sourceVoiceId: tinyVoice.id, targetVoiceId: target.id },
  };
}

function buildPhraseSplitSuggestion({
  notes,
  voices,
  lockedNoteIds,
}: SmartFixInput): SmartFixSuggestion | null {
  const sorted = [...notes]
    .filter((note) => note.voiceId !== PERCUSSION_VOICE_ID && !lockedNoteIds.has(note.id))
    .sort((left, right) => left.startTick - right.startTick || left.pitch - right.pitch);
  const grouped = notesByVoice(notes);

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (
      previous.voiceId === current.voiceId ||
      current.startTick - previous.endTick > PHRASE_GAP_TICKS ||
      Math.abs(current.pitch - previous.pitch) > PHRASE_MAX_PITCH_JUMP
    ) {
      continue;
    }

    const previousVoiceNotes = grouped.get(previous.voiceId) ?? [];
    const currentVoiceNotes = grouped.get(current.voiceId) ?? [];
    const moveCurrentToPrevious =
      previousVoiceNotes.length >= currentVoiceNotes.length &&
      voiceCanReceiveAll(previousVoiceNotes, [current]);
    const movePreviousToCurrent =
      currentVoiceNotes.length > previousVoiceNotes.length &&
      voiceCanReceiveAll(currentVoiceNotes, [previous]);
    const movedNote = moveCurrentToPrevious ? current : movePreviousToCurrent ? previous : null;
    const targetVoiceId = moveCurrentToPrevious
      ? previous.voiceId
      : movePreviousToCurrent
        ? current.voiceId
        : null;

    if (!movedNote || !targetVoiceId) {
      continue;
    }

    return {
      id: `phrase-split-${movedNote.id}-${targetVoiceId}`,
      title: `Reconnect phrase into ${voiceLabel(voices, targetVoiceId)}`,
      reason: `${formatPitchName(previous.pitch)} and ${formatPitchName(current.pitch)} are adjacent (${current.startTick - previous.endTick} ticks apart) but split between ${voiceLabel(voices, previous.voiceId)} and ${voiceLabel(voices, current.voiceId)}.`,
      actionLabel: "Assign note",
      action: { type: "assign", noteIds: [movedNote.id], targetVoiceId },
    };
  }

  return null;
}

export function buildSmartFixSuggestions(input: SmartFixInput): SmartFixSuggestion[] {
  const suggestions = [
    buildLowConfidenceClusterSuggestion(input),
    buildTinyVoiceSuggestion(input),
    buildPhraseSplitSuggestion(input),
  ].filter((suggestion): suggestion is SmartFixSuggestion => suggestion !== null);

  return suggestions.slice(0, 4);
}

export function formatSmartFixActionDetail(
  suggestion: SmartFixSuggestion,
  voices: readonly MidiVoice[],
): string {
  switch (suggestion.action.type) {
    case "select":
      return `${suggestion.action.noteIds.length} notes selected for inspection.`;
    case "assign":
      return `${suggestion.action.noteIds.length} note${suggestion.action.noteIds.length === 1 ? "" : "s"} will be locked to ${voiceLabel(voices, suggestion.action.targetVoiceId)}.`;
    case "merge":
      return `${voiceLabel(voices, suggestion.action.sourceVoiceId)} will be locked into ${voiceLabel(voices, suggestion.action.targetVoiceId)}.`;
  }
}
