import type { MidiNote, MidiProject } from "../../domain/midi/midiProject";
import type { PianoRollViewport } from "../../domain/midi/viewport";
import { pitchToY, tickToX } from "./coordinates";
import { PIANO_ROLL_LABEL_WIDTH } from "./drawPianoRoll";

export interface PianoRollPoint {
  x: number;
  y: number;
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
