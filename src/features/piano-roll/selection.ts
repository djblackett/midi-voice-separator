export type SelectionGesture =
  | { type: "click"; noteId: string | null; additive: boolean }
  | { type: "marquee"; noteIds: string[]; additive: boolean };

export interface SelectionDragPoint {
  readonly x: number;
  readonly y: number;
}

export function hasCrossedMarqueeThreshold(
  start: SelectionDragPoint,
  current: SelectionDragPoint,
  thresholdPx: number,
  alreadyCrossed = false,
): boolean {
  if (alreadyCrossed) {
    return true;
  }

  return (
    Math.abs(current.x - start.x) >= thresholdPx || Math.abs(current.y - start.y) >= thresholdPx
  );
}

export function resolveSelection(
  current: ReadonlySet<string>,
  gesture: SelectionGesture,
): Set<string> {
  if (gesture.type === "click") {
    if (gesture.noteId === null) {
      return gesture.additive ? new Set(current) : new Set();
    }

    if (!gesture.additive) {
      return new Set([gesture.noteId]);
    }

    const next = new Set(current);
    if (next.has(gesture.noteId)) {
      next.delete(gesture.noteId);
    } else {
      next.add(gesture.noteId);
    }
    return next;
  }

  if (!gesture.additive) {
    return new Set(gesture.noteIds);
  }

  return new Set([...current, ...gesture.noteIds]);
}
