import type { MidiNote, MidiProject } from "../../domain/midi/midiProject";
import type { PianoRollViewport } from "../../domain/midi/viewport";
import { pitchToY, tickToX } from "./coordinates";
import { PIANO_ROLL_LABEL_WIDTH } from "./drawPianoRoll";

/**
 * The paint sub-tools. "pencil" is the original precise single-note-under-
 * the-cursor behavior; "brush" paints every note within a round, resizable
 * brush swept along the stroke; "lasso" pours every note enclosed by a
 * freehand loop into the active voice on release.
 */
export type PaintTool = "pencil" | "brush" | "lasso";

export interface Point {
  x: number;
  y: number;
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
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
 * The screen rectangle a note occupies, mirroring the math in
 * `hitTest.ts`/`drawPianoRoll.ts`. Returns null for notes entirely hidden
 * behind the piano-key label gutter; notes partially covered are clipped
 * to the gutter edge so a brush hovering over the gutter can't paint the
 * invisible part of a scrolled-off note.
 */
function noteScreenRect(note: MidiNote, viewport: PianoRollViewport): Rect | null {
  const rollViewport = {
    ...viewport,
    width: Math.max(1, viewport.width - PIANO_ROLL_LABEL_WIDTH),
  };
  const pitchCount = rollViewport.highestPitch - rollViewport.lowestPitch + 1;
  const rowHeight = viewport.height / Math.max(1, pitchCount);

  const x = PIANO_ROLL_LABEL_WIDTH + tickToX(note.startTick, rollViewport);
  const endX = PIANO_ROLL_LABEL_WIDTH + tickToX(note.endTick, rollViewport);
  const y = pitchToY(note.pitch, rollViewport);
  const right = x + Math.max(2, endX - x);
  if (right <= PIANO_ROLL_LABEL_WIDTH) {
    return null;
  }

  return {
    left: Math.max(PIANO_ROLL_LABEL_WIDTH, x),
    top: y + 1,
    right,
    bottom: y + 1 + Math.max(2, rowHeight - 2),
  };
}

function distancePointToSegment(point: Point, a: Point, b: Point): number {
  const abX = b.x - a.x;
  const abY = b.y - a.y;
  const lengthSquared = abX * abX + abY * abY;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - a.x) * abX + (point.y - a.y) * abY) / lengthSquared));
  const closestX = a.x + t * abX;
  const closestY = a.y + t * abY;
  return Math.hypot(point.x - closestX, point.y - closestY);
}

function orientation(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);

  if (o1 * o2 < 0 && o3 * o4 < 0) {
    return true;
  }

  // Collinear touching counts as intersecting — a stroke grazing a note
  // edge should still paint it.
  const onSegment = (p: Point, q: Point, r: Point) =>
    orientation(p, q, r) === 0 &&
    Math.min(p.x, q.x) <= r.x &&
    r.x <= Math.max(p.x, q.x) &&
    Math.min(p.y, q.y) <= r.y &&
    r.y <= Math.max(p.y, q.y);

  return (
    onSegment(a1, a2, b1) || onSegment(a1, a2, b2) || onSegment(b1, b2, a1) || onSegment(b1, b2, a2)
  );
}

function pointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
  );
}

function rectCorners(rect: Rect): [Point, Point, Point, Point] {
  return [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom },
  ];
}

function rectEdges(rect: Rect): [Point, Point][] {
  const [topLeft, topRight, bottomRight, bottomLeft] = rectCorners(rect);
  return [
    [topLeft, topRight],
    [topRight, bottomRight],
    [bottomRight, bottomLeft],
    [bottomLeft, topLeft],
  ];
}

function distanceSegmentToSegment(a1: Point, a2: Point, b1: Point, b2: Point): number {
  if (segmentsIntersect(a1, a2, b1, b2)) {
    return 0;
  }
  return Math.min(
    distancePointToSegment(a1, b1, b2),
    distancePointToSegment(a2, b1, b2),
    distancePointToSegment(b1, a1, a2),
    distancePointToSegment(b2, a1, a2),
  );
}

function distanceSegmentToRect(a: Point, b: Point, rect: Rect): number {
  if (pointInRect(a, rect) || pointInRect(b, rect)) {
    return 0;
  }
  return Math.min(...rectEdges(rect).map(([e1, e2]) => distanceSegmentToSegment(a, b, e1, e2)));
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
  if (!project || project.notes.length === 0) {
    return [];
  }

  return project.notes.filter((note) => {
    const rect = noteScreenRect(note, viewport);
    return rect !== null && distanceSegmentToRect(from, to, rect) <= radius;
  });
}

export function pointInPolygon(point: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const crossesRay = a.y > point.y !== b.y > point.y;
    if (crossesRay && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function rectIntersectsPolygon(rect: Rect, polygon: readonly Point[]): boolean {
  if (rectCorners(rect).some((corner) => pointInPolygon(corner, polygon))) {
    return true;
  }
  if (polygon.some((vertex) => pointInRect(vertex, rect))) {
    return true;
  }
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    if (rectEdges(rect).some(([e1, e2]) => segmentsIntersect(polygon[i], polygon[j], e1, e2))) {
      return true;
    }
  }
  return false;
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
  if (!project || project.notes.length === 0 || path.length < 3) {
    return [];
  }

  return project.notes.filter((note) => {
    const rect = noteScreenRect(note, viewport);
    return rect !== null && rectIntersectsPolygon(rect, path);
  });
}
