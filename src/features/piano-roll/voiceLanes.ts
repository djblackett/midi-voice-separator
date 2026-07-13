import type { MidiNote, MidiVoice } from "../../domain/midi/midiProject";
import type { PianoRollViewport } from "../../domain/midi/viewport";
import { tickToX } from "./coordinates";

export const VOICE_LANE_LABEL_WIDTH = 96;
export const MIN_VOICE_LANE_HEIGHT = 36;
const LANE_PADDING_Y = 6;
const MIN_NOTE_HEIGHT = 5;
const MAX_NOTE_HEIGHT = 12;

export interface VoiceLane {
  rowIndex: number;
  voiceId: string;
  label: string;
  y: number;
  height: number;
  lowestPitch: number;
  highestPitch: number;
}

export interface VoiceLaneNoteRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function buildVoiceLaneLayout(
  voices: readonly MidiVoice[],
  viewportHeight: number,
  viewportWindow?: {
    readonly laneHeight: number;
    readonly scrollTopPx: number;
  },
): VoiceLane[] {
  if (voices.length === 0) {
    return [];
  }

  const laneHeight =
    viewportWindow?.laneHeight ?? Math.max(MIN_VOICE_LANE_HEIGHT, viewportHeight / voices.length);
  const scrollTopPx = viewportWindow?.scrollTopPx ?? 0;
  return voices.map((voice, index) => ({
    rowIndex: index,
    voiceId: voice.id,
    label: voice.label,
    y: index * laneHeight - scrollTopPx,
    height: laneHeight,
    lowestPitch: voice.lowestPitch,
    highestPitch: voice.highestPitch,
  }));
}

export function findVoiceLane(lanes: readonly VoiceLane[], voiceId: string): VoiceLane | null {
  return lanes.find((lane) => lane.voiceId === voiceId) ?? null;
}

export function findVoiceLaneAtY(lanes: readonly VoiceLane[], y: number): VoiceLane | null {
  return lanes.find((lane) => y >= lane.y && y <= lane.y + lane.height) ?? null;
}

export function voiceLaneNoteRect(
  note: MidiNote,
  lane: VoiceLane,
  viewport: PianoRollViewport,
): VoiceLaneNoteRect {
  const rollViewport = {
    ...viewport,
    width: Math.max(1, viewport.width - VOICE_LANE_LABEL_WIDTH),
  };
  const innerHeight = Math.max(1, lane.height - LANE_PADDING_Y * 2);
  const pitchSpan = Math.max(1, lane.highestPitch - lane.lowestPitch + 1);
  const noteHeight = Math.min(MAX_NOTE_HEIGHT, Math.max(MIN_NOTE_HEIGHT, innerHeight / pitchSpan));
  const pitchOffset =
    ((lane.highestPitch - note.pitch) / pitchSpan) * Math.max(1, innerHeight - noteHeight);
  const x = VOICE_LANE_LABEL_WIDTH + tickToX(note.startTick, rollViewport);
  const endX = VOICE_LANE_LABEL_WIDTH + tickToX(note.endTick, rollViewport);

  return {
    x,
    y: lane.y + LANE_PADDING_Y + pitchOffset,
    width: Math.max(2, endX - x),
    height: noteHeight,
  };
}
