import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { MidiProject } from "../../domain/midi/midiProject";
import { buildViewport, drawPianoRoll, type MarqueeRect } from "./drawPianoRoll";
import { hitTestPianoRollNote, hitTestPianoRollNotesInRect } from "./hitTest";
import { shouldPaintNote } from "./paint";
import { resolveSelection } from "./selection";

const MARQUEE_THRESHOLD_PX = 4;

export type InteractionMode = "select" | "paint";

interface PianoRollProps {
  project: MidiProject | null;
  selectedNoteIds: ReadonlySet<string>;
  onSelectionChange: (next: ReadonlySet<string>) => void;
  soloVoiceId?: string | null;
  interactionMode?: InteractionMode;
  activeVoiceId?: string | null;
  onPaintNotes?: (noteIds: string[]) => void;
}

export function PianoRoll({
  project,
  selectedNoteIds,
  onSelectionChange,
  soloVoiceId = null,
  interactionMode = "select",
  activeVoiceId = null,
  onPaintNotes = () => {},
}: PianoRollProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [marqueeRect, setMarqueeRect] = useState<MarqueeRect | null>(null);
  const dragStartRef = useRef<{ point: { x: number; y: number }; additive: boolean } | null>(null);
  const isPaintingRef = useRef(false);
  const paintedNoteIdsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) {
        return;
      }
      setSize({
        width: Math.floor(entry.contentRect.width),
        height: Math.floor(entry.contentRect.height),
      });
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  const viewport = useMemo(() => buildViewport(project, size.width, size.height), [project, size]);

  const marqueePreviewIds = useMemo(() => {
    if (!marqueeRect) {
      return null;
    }
    return hitTestPianoRollNotesInRect(marqueeRect, project, viewport).map((note) => note.id);
  }, [marqueeRect, project, viewport]);

  const effectiveSelection = useMemo(() => {
    if (!marqueePreviewIds || !dragStartRef.current) {
      return selectedNoteIds;
    }
    return resolveSelection(selectedNoteIds, {
      type: "marquee",
      noteIds: marqueePreviewIds,
      additive: dragStartRef.current.additive,
    });
  }, [marqueePreviewIds, selectedNoteIds]);

  function redrawCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    drawPianoRoll(
      context,
      project,
      viewport,
      effectiveSelection,
      marqueeRect,
      soloVoiceId,
      paintedNoteIdsRef.current,
    );
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width <= 0 || size.height <= 0) {
      return;
    }

    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(size.width * ratio);
    canvas.height = Math.floor(size.height * ratio);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawPianoRoll(
      context,
      project,
      viewport,
      effectiveSelection,
      marqueeRect,
      soloVoiceId,
      paintedNoteIdsRef.current,
    );
  }, [project, viewport, effectiveSelection, marqueeRect, size, soloVoiceId]);

  function pointFromEvent(event: ReactPointerEvent<HTMLCanvasElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (size.width <= 0 || size.height <= 0) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);

    if (interactionMode === "paint") {
      if (!activeVoiceId) {
        return;
      }
      isPaintingRef.current = true;
      paintedNoteIdsRef.current = new Map();
      const note = hitTestPianoRollNote(pointFromEvent(event), project, viewport);
      if (note && shouldPaintNote(note, activeVoiceId, new Set())) {
        paintedNoteIdsRef.current.set(note.id, activeVoiceId);
        redrawCanvas();
      }
      return;
    }

    dragStartRef.current = { point: pointFromEvent(event), additive: event.shiftKey };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (interactionMode === "paint") {
      if (!isPaintingRef.current || !activeVoiceId) {
        return;
      }
      const note = hitTestPianoRollNote(pointFromEvent(event), project, viewport);
      if (note && shouldPaintNote(note, activeVoiceId, new Set(paintedNoteIdsRef.current.keys()))) {
        paintedNoteIdsRef.current.set(note.id, activeVoiceId);
        redrawCanvas();
      }
      return;
    }

    const dragStart = dragStartRef.current;
    if (!dragStart) {
      return;
    }

    const point = pointFromEvent(event);
    const movedPastThreshold =
      Math.abs(point.x - dragStart.point.x) >= MARQUEE_THRESHOLD_PX ||
      Math.abs(point.y - dragStart.point.y) >= MARQUEE_THRESHOLD_PX;

    if (movedPastThreshold || marqueeRect) {
      setMarqueeRect({ x0: dragStart.point.x, y0: dragStart.point.y, x1: point.x, y1: point.y });
    }
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (interactionMode === "paint") {
      if (isPaintingRef.current) {
        isPaintingRef.current = false;
        const paintedIds = Array.from(paintedNoteIdsRef.current.keys());
        paintedNoteIdsRef.current = new Map();
        if (paintedIds.length > 0) {
          onPaintNotes(paintedIds);
        }
      }
      return;
    }

    const dragStart = dragStartRef.current;
    if (!dragStart) {
      return;
    }

    const point = pointFromEvent(event);

    if (marqueeRect) {
      const noteIds = hitTestPianoRollNotesInRect(
        { x0: dragStart.point.x, y0: dragStart.point.y, x1: point.x, y1: point.y },
        project,
        viewport,
      ).map((note) => note.id);
      onSelectionChange(
        resolveSelection(selectedNoteIds, {
          type: "marquee",
          noteIds,
          additive: dragStart.additive,
        }),
      );
    } else {
      const note = hitTestPianoRollNote(point, project, viewport);
      onSelectionChange(
        resolveSelection(selectedNoteIds, {
          type: "click",
          noteId: note?.id ?? null,
          additive: dragStart.additive,
        }),
      );
    }

    dragStartRef.current = null;
    setMarqueeRect(null);
  }

  return (
    <div className="piano-roll-shell" ref={containerRef}>
      <canvas
        ref={canvasRef}
        aria-label="Piano roll note visualization"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
    </div>
  );
}
