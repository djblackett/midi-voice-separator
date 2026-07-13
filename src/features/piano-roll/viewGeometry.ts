import type { MidiNote, MidiProject } from "../../domain/midi/midiProject";
import type { PianoRollViewport } from "../../domain/midi/viewport";
import { pitchToY, tickToX } from "./coordinates";
import {
  buildVoiceLaneLayout,
  findVoiceLane,
  type VoiceLane,
  voiceLaneNoteRect,
  VOICE_LANE_LABEL_WIDTH,
} from "./voiceLanes";

export const PIANO_VIEW_GUTTER_WIDTH = 56;

export type EditorViewKind = "piano" | "voice-lanes";

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

export interface ScreenDragRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface ScreenRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface ViewCapabilities {
  readonly clickSelection: boolean;
  readonly marqueeSelection: boolean;
  readonly contextActions: boolean;
  readonly audition: boolean;
  readonly pencil: boolean;
  readonly brush: boolean;
  readonly lasso: boolean;
  readonly wand: boolean;
  readonly pitchRangeMarkers: boolean;
  readonly verticalAxis: "pitch" | "lanes";
}

export type VerticalRevealTarget =
  | { readonly kind: "pitch"; readonly lowestPitch: number; readonly highestPitch: number }
  | { readonly kind: "lanes"; readonly voiceIds: readonly string[] };

export interface ViewRevealTarget {
  readonly startTick: number;
  readonly endTick: number;
  readonly vertical: VerticalRevealTarget;
}

/**
 * Geometry owns layout, not the set of notes a gesture may touch. Query helpers
 * accept that set explicitly because filtered views can render one project while
 * authorizing interaction with only a subset of its notes.
 */
export interface ViewGeometry {
  readonly kind: EditorViewKind;
  readonly gutterWidth: number;
  readonly capabilities: ViewCapabilities;
  readonly laneRows: readonly VoiceLane[] | null;
  noteRect(note: MidiNote): ScreenRect | null;
  revealTarget(notes: readonly MidiNote[]): ViewRevealTarget | null;
}

export interface VoiceLaneGeometryViewport {
  /** Callers must resolve and clamp this offset before constructing geometry. */
  readonly scrollTopPx?: number;
}

const COMMON_CAPABILITIES = {
  clickSelection: true,
  marqueeSelection: true,
  contextActions: true,
  audition: true,
  pencil: true,
  brush: true,
  lasso: true,
  wand: true,
} as const;

export const PIANO_VIEW_CAPABILITIES: ViewCapabilities = {
  ...COMMON_CAPABILITIES,
  pitchRangeMarkers: true,
  verticalAxis: "pitch",
};

export const VOICE_LANE_VIEW_CAPABILITIES: ViewCapabilities = {
  ...COMMON_CAPABILITIES,
  pitchRangeMarkers: false,
  verticalAxis: "lanes",
};

function contentViewport(viewport: PianoRollViewport, gutterWidth: number): PianoRollViewport {
  return {
    ...viewport,
    width: Math.max(1, viewport.width - gutterWidth),
  };
}

function gutterClippedRect(
  left: number,
  top: number,
  width: number,
  height: number,
  gutterWidth: number,
): ScreenRect | null {
  const right = left + width;
  if (right <= gutterWidth) {
    return null;
  }

  return {
    left: Math.max(gutterWidth, left),
    top,
    right,
    bottom: top + height,
  };
}

function temporalBounds(
  notes: readonly MidiNote[],
): Pick<ViewRevealTarget, "startTick" | "endTick"> | null {
  const first = notes[0];
  if (!first) {
    return null;
  }

  let startTick = first.startTick;
  let endTick = first.endTick;
  for (let index = 1; index < notes.length; index += 1) {
    const note = notes[index];
    startTick = Math.min(startTick, note.startTick);
    endTick = Math.max(endTick, note.endTick);
  }

  return { startTick, endTick };
}

export function createPianoViewGeometry(
  _project: MidiProject | null,
  viewport: PianoRollViewport,
): ViewGeometry {
  const rollViewport = contentViewport(viewport, PIANO_VIEW_GUTTER_WIDTH);
  const pitchCount = rollViewport.highestPitch - rollViewport.lowestPitch + 1;
  const rowHeight = viewport.height / Math.max(1, pitchCount);

  return {
    kind: "piano",
    gutterWidth: PIANO_VIEW_GUTTER_WIDTH,
    capabilities: PIANO_VIEW_CAPABILITIES,
    laneRows: null,
    noteRect(note) {
      const left = PIANO_VIEW_GUTTER_WIDTH + tickToX(note.startTick, rollViewport);
      const end = PIANO_VIEW_GUTTER_WIDTH + tickToX(note.endTick, rollViewport);
      const top = pitchToY(note.pitch, rollViewport) + 1;
      return gutterClippedRect(
        left,
        top,
        Math.max(2, end - left),
        Math.max(2, rowHeight - 2),
        PIANO_VIEW_GUTTER_WIDTH,
      );
    },
    revealTarget(notes) {
      const bounds = temporalBounds(notes);
      if (!bounds) {
        return null;
      }

      let lowestPitch = notes[0].pitch;
      let highestPitch = notes[0].pitch;
      for (let index = 1; index < notes.length; index += 1) {
        lowestPitch = Math.min(lowestPitch, notes[index].pitch);
        highestPitch = Math.max(highestPitch, notes[index].pitch);
      }

      return {
        ...bounds,
        vertical: { kind: "pitch", lowestPitch, highestPitch },
      };
    },
  };
}

export function createVoiceLaneViewGeometry(
  project: MidiProject | null,
  viewport: PianoRollViewport,
  laneViewport: VoiceLaneGeometryViewport = {},
): ViewGeometry {
  const scrollTopPx = laneViewport.scrollTopPx ?? 0;
  const laneRows = buildVoiceLaneLayout(project?.voices ?? [], viewport.height).map((lane) => ({
    ...lane,
    y: lane.y - scrollTopPx,
  }));

  return {
    kind: "voice-lanes",
    gutterWidth: VOICE_LANE_LABEL_WIDTH,
    capabilities: VOICE_LANE_VIEW_CAPABILITIES,
    laneRows,
    noteRect(note) {
      const lane = findVoiceLane(laneRows, note.voiceId);
      if (!lane) {
        return null;
      }

      const rect = voiceLaneNoteRect(note, lane, viewport);
      return gutterClippedRect(rect.x, rect.y, rect.width, rect.height, VOICE_LANE_LABEL_WIDTH);
    },
    revealTarget(notes) {
      const selectedVoiceIds = new Set(notes.map((note) => note.voiceId));
      const voiceIds = laneRows
        .filter((lane) => selectedVoiceIds.has(lane.voiceId))
        .map((lane) => lane.voiceId);
      if (voiceIds.length === 0) {
        return null;
      }

      const visibleVoiceIds = new Set(voiceIds);
      const visibleNotes = notes.filter((note) => visibleVoiceIds.has(note.voiceId));
      const bounds = temporalBounds(visibleNotes);
      if (!bounds) {
        return null;
      }

      return {
        ...bounds,
        vertical: { kind: "lanes", voiceIds },
      };
    },
  };
}

function comparePointHitPriority(left: MidiNote, right: MidiNote): number {
  const leftDuration = Math.max(1, left.durationTicks);
  const rightDuration = Math.max(1, right.durationTicks);

  return (
    leftDuration - rightDuration ||
    right.startTick - left.startTick ||
    right.pitch - left.pitch ||
    left.id.localeCompare(right.id)
  );
}

function pointInRect(point: ScreenPoint, rect: ScreenRect): boolean {
  return (
    point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
  );
}

function interactiveRect(rect: ScreenRect | null, gutterWidth: number): ScreenRect | null {
  if (!rect || rect.right <= gutterWidth) {
    return null;
  }

  return rect.left < gutterWidth ? { ...rect, left: gutterWidth } : rect;
}

export function hitTestNoteAtPoint(
  point: ScreenPoint,
  notes: readonly MidiNote[],
  geometry: ViewGeometry,
): MidiNote | null {
  if (point.x < geometry.gutterWidth || notes.length === 0) {
    return null;
  }

  return (
    [...notes].sort(comparePointHitPriority).find((note) => {
      const rect = interactiveRect(geometry.noteRect(note), geometry.gutterWidth);
      return rect !== null && pointInRect(point, rect);
    }) ?? null
  );
}

export function hitTestNotesInRect(
  dragRect: ScreenDragRect,
  notes: readonly MidiNote[],
  geometry: ViewGeometry,
): MidiNote[] {
  if (notes.length === 0) {
    return [];
  }

  const left = Math.min(dragRect.x0, dragRect.x1);
  const right = Math.max(dragRect.x0, dragRect.x1);
  const top = Math.min(dragRect.y0, dragRect.y1);
  const bottom = Math.max(dragRect.y0, dragRect.y1);
  if (right < geometry.gutterWidth) {
    return [];
  }

  return notes.filter((note) => {
    const rect = interactiveRect(geometry.noteRect(note), geometry.gutterWidth);
    return (
      rect !== null &&
      rect.left <= right &&
      rect.right >= left &&
      rect.top <= bottom &&
      rect.bottom >= top
    );
  });
}

function distancePointToSegment(point: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number {
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

function orientation(a: ScreenPoint, b: ScreenPoint, c: ScreenPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect(
  a1: ScreenPoint,
  a2: ScreenPoint,
  b1: ScreenPoint,
  b2: ScreenPoint,
): boolean {
  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);

  if (o1 * o2 < 0 && o3 * o4 < 0) {
    return true;
  }

  const onSegment = (p: ScreenPoint, q: ScreenPoint, r: ScreenPoint) =>
    orientation(p, q, r) === 0 &&
    Math.min(p.x, q.x) <= r.x &&
    r.x <= Math.max(p.x, q.x) &&
    Math.min(p.y, q.y) <= r.y &&
    r.y <= Math.max(p.y, q.y);

  return (
    onSegment(a1, a2, b1) || onSegment(a1, a2, b2) || onSegment(b1, b2, a1) || onSegment(b1, b2, a2)
  );
}

function rectCorners(rect: ScreenRect): [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint] {
  return [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom },
  ];
}

function rectEdges(rect: ScreenRect): [ScreenPoint, ScreenPoint][] {
  const [topLeft, topRight, bottomRight, bottomLeft] = rectCorners(rect);
  return [
    [topLeft, topRight],
    [topRight, bottomRight],
    [bottomRight, bottomLeft],
    [bottomLeft, topLeft],
  ];
}

function distanceSegmentToSegment(
  a1: ScreenPoint,
  a2: ScreenPoint,
  b1: ScreenPoint,
  b2: ScreenPoint,
): number {
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

function distanceSegmentToRect(a: ScreenPoint, b: ScreenPoint, rect: ScreenRect): number {
  if (pointInRect(a, rect) || pointInRect(b, rect)) {
    return 0;
  }

  return Math.min(
    ...rectEdges(rect).map(([edgeA, edgeB]) => distanceSegmentToSegment(a, b, edgeA, edgeB)),
  );
}

export function notesInBrushStampForView(
  from: ScreenPoint,
  to: ScreenPoint,
  radius: number,
  notes: readonly MidiNote[],
  geometry: ViewGeometry,
): MidiNote[] {
  if (notes.length === 0) {
    return [];
  }

  return notes.filter((note) => {
    const rect = interactiveRect(geometry.noteRect(note), geometry.gutterWidth);
    return rect !== null && distanceSegmentToRect(from, to, rect) <= radius;
  });
}

function pointInPolygon(point: ScreenPoint, polygon: readonly ScreenPoint[]): boolean {
  let inside = false;
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index, index += 1
  ) {
    const a = polygon[index];
    const b = polygon[previous];
    const crossesRay = a.y > point.y !== b.y > point.y;
    if (crossesRay && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function rectIntersectsPolygon(rect: ScreenRect, polygon: readonly ScreenPoint[]): boolean {
  if (rectCorners(rect).some((corner) => pointInPolygon(corner, polygon))) {
    return true;
  }
  if (polygon.some((vertex) => pointInRect(vertex, rect))) {
    return true;
  }
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index, index += 1
  ) {
    if (
      rectEdges(rect).some(([edgeA, edgeB]) =>
        segmentsIntersect(polygon[index], polygon[previous], edgeA, edgeB),
      )
    ) {
      return true;
    }
  }
  return false;
}

export function notesInLassoPathForView(
  path: readonly ScreenPoint[],
  notes: readonly MidiNote[],
  geometry: ViewGeometry,
): MidiNote[] {
  if (notes.length === 0 || path.length < 3) {
    return [];
  }

  return notes.filter((note) => {
    const rect = interactiveRect(geometry.noteRect(note), geometry.gutterWidth);
    return rect !== null && rectIntersectsPolygon(rect, path);
  });
}
