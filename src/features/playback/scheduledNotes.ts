import type { MidiNote } from "../../domain/midi/midiProject";
import { tickToSeconds, type TempoMap } from "../../domain/midi/tempoMap";
import { voiceColorIndex } from "../piano-roll/drawPianoRoll";
import { midiPitchToFrequency } from "./frequency";

export type Waveform = "square" | "triangle" | "sawtooth";

const WAVEFORMS: Waveform[] = ["square", "triangle", "sawtooth"];

/** A small fixed per-note gain keeps overlapping notes from clipping. */
const NOTE_GAIN = 0.12;

export interface ScheduledNote {
  id: string;
  startSeconds: number;
  endSeconds: number;
  frequency: number;
  gain: number;
  waveform: Waveform;
}

export function waveformForVoice(voiceId: string): Waveform {
  return WAVEFORMS[voiceColorIndex(voiceId) % WAVEFORMS.length];
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
): ScheduledNote[] {
  const scheduled: ScheduledNote[] = [];

  for (const note of notes) {
    if (note.endTick <= startTick) {
      continue;
    }
    if (soloVoiceId !== null && note.voiceId !== soloVoiceId) {
      continue;
    }

    // A note already in progress at the resume point starts immediately
    // with its remaining duration, rather than being skipped or starting
    // late at its original tick.
    const effectiveStartTick = Math.max(note.startTick, startTick);

    scheduled.push({
      id: note.id,
      startSeconds:
        tickToSeconds(tempoMap, effectiveStartTick) - tickToSeconds(tempoMap, startTick),
      endSeconds: tickToSeconds(tempoMap, note.endTick) - tickToSeconds(tempoMap, startTick),
      frequency: midiPitchToFrequency(note.pitch),
      gain: NOTE_GAIN,
      waveform: waveformForVoice(note.voiceId),
    });
  }

  return scheduled;
}
