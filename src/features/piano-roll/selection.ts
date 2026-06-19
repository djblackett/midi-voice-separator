export type SelectionGesture =
  | { type: "click"; noteId: string | null; additive: boolean }
  | { type: "marquee"; noteIds: string[]; additive: boolean };

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
