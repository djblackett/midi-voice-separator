import type { MidiNote, MidiProject } from "../../domain/midi/midiProject";
import type { PianoRollViewport } from "../../domain/midi/viewport";
import type { ViewCapabilities } from "./viewGeometry";
import {
  createPianoViewGeometry,
  notesInBrushStampForView,
  notesInLassoPathForView,
} from "./viewGeometry";

export { pointInPolygon } from "./viewGeometry";

/**
 * The paint sub-tools. "pencil" is the original precise single-note-under-
 * the-cursor behavior; "brush" paints every note within a round, resizable
 * brush swept along the stroke; "lasso" pours every note enclosed by a
 * freehand loop into the active voice on release; "wand" flood-fills the
 * connected melodic phrase around the clicked note (see
 * `smartSelect.ts`'s `selectPhrase`).
 */
export type PaintTool = "pencil" | "brush" | "lasso" | "wand";

export function supportsPaintTool(capabilities: ViewCapabilities, tool: PaintTool): boolean {
  return capabilities[tool];
}

export interface Point {
  x: number;
  y: number;
}

export const MIN_BRUSH_RADIUS = 6;
export const MAX_BRUSH_RADIUS = 72;
export const DEFAULT_BRUSH_RADIUS = 18;

export function clampBrushRadius(radius: number): number {
  return Math.min(MAX_BRUSH_RADIUS, Math.max(MIN_BRUSH_RADIUS, Math.round(radius)));
}

/**
 * One keyboard/wheel notch of brush resizing. Multiplicative so growth
 * feels even across the whole range, but guaranteed to move at least 1px
 * so small radii don't get stuck on rounding.
 */
export function stepBrushRadius(radius: number, direction: 1 | -1): number {
  const scaled = Math.round(radius * (direction === 1 ? 1.15 : 1 / 1.15));
  const next = scaled === radius ? radius + direction : scaled;
  return clampBrushRadius(next);
}

/**
 * Every note touched by a round brush of `radius` swept from `from` to
 * `to` (a capsule). Called per pointer-move sample with the previous
 * sample as `from`, so fast strokes can't skip over notes between events.
 */
export function notesInBrushStamp(
  from: Point,
  to: Point,
  radius: number,
  project: MidiProject | null,
  viewport: PianoRollViewport,
): MidiNote[] {
  const notes = project?.notes ?? [];
  return notesInBrushStampForView(
    from,
    to,
    radius,
    notes,
    createPianoViewGeometry(project, viewport),
  );
}

/**
 * Every note enclosed by (or touching) the freehand lasso `path`. The
 * path is treated as a closed polygon — the gap between its last and
 * first points is implicitly closed, matching how the overlay draws it.
 */
export function notesInLassoPath(
  path: readonly Point[],
  project: MidiProject | null,
  viewport: PianoRollViewport,
): MidiNote[] {
  const notes = project?.notes ?? [];
  return notesInLassoPathForView(path, notes, createPianoViewGeometry(project, viewport));
}
