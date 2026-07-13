import type { MidiNote } from "../../domain/midi/midiProject";
import { selectPhrase } from "./smartSelect";
import { hitTestNoteAtPoint, type ScreenPoint, type ViewGeometry } from "./viewGeometry";

export function shouldPaintNote(
  note: { id: string; voiceId: string },
  activeVoiceId: string,
  alreadyPainted: ReadonlySet<string>,
): boolean {
  return note.voiceId !== activeVoiceId && !alreadyPainted.has(note.id);
}

export function resolvePencilPaintAnchor(
  point: ScreenPoint,
  permittedNotes: readonly MidiNote[],
  geometry: ViewGeometry,
): MidiNote | null {
  return geometry.capabilities.pencil ? hitTestNoteAtPoint(point, permittedNotes, geometry) : null;
}

export interface WandPaintTarget {
  readonly anchor: MidiNote;
  readonly phrase: readonly MidiNote[];
}

export function resolveWandPaintTarget(
  point: ScreenPoint,
  permittedNotes: readonly MidiNote[],
  geometry: ViewGeometry,
  maxGapTicks: number,
  maxPitchJumpSemitones: number,
): WandPaintTarget | null {
  if (!geometry.capabilities.wand) {
    return null;
  }
  const anchor = hitTestNoteAtPoint(point, permittedNotes, geometry);
  if (!anchor) {
    return null;
  }

  return {
    anchor,
    phrase: selectPhrase(anchor, permittedNotes, { maxGapTicks, maxPitchJumpSemitones }),
  };
}
