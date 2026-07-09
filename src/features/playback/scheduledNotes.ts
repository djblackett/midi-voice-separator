import type { MidiNote } from "../../domain/midi/midiProject";
import { tickToSeconds, type TempoMap } from "../../domain/midi/tempoMap";
import { voiceColorIndex } from "../piano-roll/drawPianoRoll";
import { midiPitchToFrequency } from "./frequency";

export type Waveform = "square" | "triangle" | "sawtooth";

const WAVEFORMS: Waveform[] = ["square", "triangle", "sawtooth"];

/** A small fixed per-note gain keeps overlapping notes from clipping. */
const NOTE_GAIN = 0.12;

/** Audition blips are short and quieter than real playback. */
export const AUDITION_SECONDS = 0.18;
const AUDITION_GAIN = 0.08;
const MAX_AUDITION_NOTES = 6;

export interface ScheduledNote {
  id: string;
  startSeconds: number;
  endSeconds: number;
  /** MIDI pitch, kept alongside frequency so the piano sampler can pick the nearest sample. */
  pitch: number;
  frequency: number;
  gain: number;
  waveform: Waveform;
}

export type PlaybackScope =
  | { type: "all" }
  | { type: "selected"; noteIds: ReadonlySet<string> }
  | { type: "voice"; voiceId: string | null }
  | { type: "changed"; noteIds: ReadonlySet<string> }
  | { type: "around-note"; noteId: string | null; beforeTicks: number; afterTicks: number };

export interface PlaybackScopeFilterResult {
  notes: readonly MidiNote[];
  scopeMatchedCount: number;
  emptyReason: string | null;
}

export function waveformForVoice(voiceId: string): Waveform {
  return WAVEFORMS[voiceColorIndex(voiceId) % WAVEFORMS.length];
}

/**
 * Short preview blips for painting/clicking notes (DAW-style audition):
 * every note starts immediately, plays briefly and quietly, and keeps its
 * voice's waveform so a note sounds the way its voice sounds in real
 * playback. Capped so double-clicking a dense chord can't blast.
 */
export function buildAuditionNotes(notes: readonly MidiNote[]): ScheduledNote[] {
  return notes.slice(0, MAX_AUDITION_NOTES).map((note) => ({
    id: `audition-${note.id}`,
    startSeconds: 0,
    endSeconds: AUDITION_SECONDS,
    pitch: note.pitch,
    frequency: midiPitchToFrequency(note.pitch),
    gain: AUDITION_GAIN,
    waveform: waveformForVoice(note.voiceId),
  }));
}

function noteIsInScope(
  note: MidiNote,
  allNotes: readonly MidiNote[],
  scope: PlaybackScope,
): boolean {
  switch (scope.type) {
    case "all":
      return true;
    case "selected":
    case "changed":
      return scope.noteIds.has(note.id);
    case "voice":
      return scope.voiceId !== null && note.voiceId === scope.voiceId;
    case "around-note": {
      if (!scope.noteId) {
        return false;
      }
      const anchor = allNotes.find((candidate) => candidate.id === scope.noteId);
      if (!anchor) {
        return false;
      }
      const windowStart = Math.max(0, anchor.startTick - scope.beforeTicks);
      const windowEnd = anchor.endTick + scope.afterTicks;
      return note.endTick > windowStart && note.startTick < windowEnd;
    }
  }
}

export function filterNotesForPlaybackScope(
  notes: readonly MidiNote[],
  startTick: number,
  soloVoiceId: string | null,
  scope: PlaybackScope = { type: "all" },
): PlaybackScopeFilterResult {
  const activeNotes = notes.filter((note) => note.endTick > startTick);
  const scopedNotes = activeNotes.filter((note) => noteIsInScope(note, notes, scope));
  const filteredNotes =
    soloVoiceId === null ? scopedNotes : scopedNotes.filter((note) => note.voiceId === soloVoiceId);

  let emptyReason: string | null = null;
  if (scopedNotes.length === 0 && scope.type !== "all") {
    emptyReason = "No notes in playback scope.";
  } else if (filteredNotes.length === 0 && soloVoiceId !== null) {
    emptyReason = "No notes in scope for soloed voice.";
  }

  return {
    notes: filteredNotes,
    scopeMatchedCount: scopedNotes.length,
    emptyReason,
  };
}

/**
 * Decides exactly what should play starting from `startTick`: the only
 * function in the playback feature that makes decisions, so it's the only
 * one that needs (or gets) unit tests — `playbackEngine.ts` just iterates
 * the result and issues real Web Audio calls.
 */
export function buildScheduledNotes(
  notes: readonly MidiNote[],
  tempoMap: TempoMap,
  startTick: number,
  soloVoiceId: string | null,
  scope: PlaybackScope = { type: "all" },
): ScheduledNote[] {
  const scheduled: ScheduledNote[] = [];
  const { notes: scopedNotes } = filterNotesForPlaybackScope(notes, startTick, soloVoiceId, scope);

  for (const note of scopedNotes) {
    // A note already in progress at the resume point starts immediately
    // with its remaining duration, rather than being skipped or starting
    // late at its original tick.
    const effectiveStartTick = Math.max(note.startTick, startTick);

    scheduled.push({
      id: note.id,
      startSeconds:
        tickToSeconds(tempoMap, effectiveStartTick) - tickToSeconds(tempoMap, startTick),
      endSeconds: tickToSeconds(tempoMap, note.endTick) - tickToSeconds(tempoMap, startTick),
      pitch: note.pitch,
      frequency: midiPitchToFrequency(note.pitch),
      gain: NOTE_GAIN,
      waveform: waveformForVoice(note.voiceId),
    });
  }

  return scheduled;
}
