import type { MidiNote, MidiProject } from "../../domain/midi/midiProject";
import type { PianoRollViewport } from "../../domain/midi/viewport";
import { pitchToY, tickToX } from "./coordinates";
import { PIANO_ROLL_LABEL_WIDTH } from "./drawPianoRoll";
import {
  buildVoiceLaneLayout,
  findVoiceLane,
  voiceLaneNoteRect,
  VOICE_LANE_LABEL_WIDTH,
} from "./voiceLanes";

export interface PianoRollPoint {
  x: number;
  y: number;
}

export interface PianoRollRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function hitTestPianoRollNotesInRect(
  rect: PianoRollRect,
  project: MidiProject | null,
  viewport: PianoRollViewport,
): MidiNote[] {
  if (!project || project.notes.length === 0) {
    return [];
  }

  const left = Math.min(rect.x0, rect.x1);
  const right = Math.max(rect.x0, rect.x1);
  const top = Math.min(rect.y0, rect.y1);
  const bottom = Math.max(rect.y0, rect.y1);

  if (right < PIANO_ROLL_LABEL_WIDTH) {
    return [];
  }

  const rollViewport = {
    ...viewport,
    width: Math.max(1, viewport.width - PIANO_ROLL_LABEL_WIDTH),
  };
  const pitchCount = rollViewport.highestPitch - rollViewport.lowestPitch + 1;
  const rowHeight = viewport.height / Math.max(1, pitchCount);

  return project.notes.filter((note) => {
    const noteX = PIANO_ROLL_LABEL_WIDTH + tickToX(note.startTick, rollViewport);
    const noteY = pitchToY(note.pitch, rollViewport);
    const noteEndX = PIANO_ROLL_LABEL_WIDTH + tickToX(note.endTick, rollViewport);
    const noteWidth = Math.max(2, noteEndX - noteX);
    const noteHeight = Math.max(2, rowHeight - 2);

    return (
      noteX <= right &&
      noteX + noteWidth >= left &&
      noteY + 1 <= bottom &&
      noteY + 1 + noteHeight >= top
    );
  });
}

export function hitTestPianoRollNote(
  point: PianoRollPoint,
  project: MidiProject | null,
  viewport: PianoRollViewport,
): MidiNote | null {
  if (!project || project.notes.length === 0 || point.x < PIANO_ROLL_LABEL_WIDTH) {
    return null;
  }

  const rollViewport = {
    ...viewport,
    width: Math.max(1, viewport.width - PIANO_ROLL_LABEL_WIDTH),
  };
  const pitchCount = rollViewport.highestPitch - rollViewport.lowestPitch + 1;
  const rowHeight = viewport.height / Math.max(1, pitchCount);

  return (
    [...project.notes]
      .sort((left, right) => {
        const leftArea = Math.max(1, left.durationTicks);
        const rightArea = Math.max(1, right.durationTicks);

        return (
          leftArea - rightArea ||
          right.startTick - left.startTick ||
          right.pitch - left.pitch ||
          left.id.localeCompare(right.id)
        );
      })
      .find((note) => {
        const noteX = PIANO_ROLL_LABEL_WIDTH + tickToX(note.startTick, rollViewport);
        const noteY = pitchToY(note.pitch, rollViewport);
        const noteEndX = PIANO_ROLL_LABEL_WIDTH + tickToX(note.endTick, rollViewport);
        const noteWidth = Math.max(2, noteEndX - noteX);
        const noteHeight = Math.max(2, rowHeight - 2);

        return (
          point.x >= noteX &&
          point.x <= noteX + noteWidth &&
          point.y >= noteY + 1 &&
          point.y <= noteY + 1 + noteHeight
        );
      }) ?? null
  );
}

export function hitTestVoiceLaneNote(
  point: PianoRollPoint,
  project: MidiProject | null,
  viewport: PianoRollViewport,
): MidiNote | null {
  if (!project || project.notes.length === 0 || point.x < VOICE_LANE_LABEL_WIDTH) {
    return null;
  }

  const lanes = buildVoiceLaneLayout(project.voices, viewport.height);
  return (
    [...project.notes]
      .sort((left, right) => {
        const leftArea = Math.max(1, left.durationTicks);
        const rightArea = Math.max(1, right.durationTicks);

        return (
          leftArea - rightArea ||
          right.startTick - left.startTick ||
          right.pitch - left.pitch ||
          left.id.localeCompare(right.id)
        );
      })
      .find((note) => {
        const lane = findVoiceLane(lanes, note.voiceId);
        if (!lane) {
          return false;
        }
        const rect = voiceLaneNoteRect(note, lane, viewport);
        return (
          point.x >= rect.x &&
          point.x <= rect.x + rect.width &&
          point.y >= rect.y &&
          point.y <= rect.y + rect.height
        );
      }) ?? null
  );
}
