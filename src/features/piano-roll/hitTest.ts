import type { MidiNote, MidiProject } from "../../domain/midi/midiProject";
import type { PianoRollViewport } from "../../domain/midi/viewport";
import {
  createPianoViewGeometry,
  createVoiceLaneViewGeometry,
  hitTestNoteAtPoint,
  hitTestNotesInRect,
} from "./viewGeometry";

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
  const notes = project?.notes ?? [];
  return hitTestNotesInRect(rect, notes, createPianoViewGeometry(project, viewport));
}

export function hitTestPianoRollNote(
  point: PianoRollPoint,
  project: MidiProject | null,
  viewport: PianoRollViewport,
): MidiNote | null {
  const notes = project?.notes ?? [];
  return hitTestNoteAtPoint(point, notes, createPianoViewGeometry(project, viewport));
}

export function hitTestVoiceLaneNote(
  point: PianoRollPoint,
  project: MidiProject | null,
  viewport: PianoRollViewport,
): MidiNote | null {
  const notes = project?.notes ?? [];
  return hitTestNoteAtPoint(point, notes, createVoiceLaneViewGeometry(project, viewport));
}
