import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { MidiProject } from "../../domain/midi/midiProject";
import { clampMidiPitch, type PitchMarker } from "../../domain/midi/rangeRules";
import { pitchToY, xToTick, yToPitch } from "./coordinates";
import {
  buildViewport,
  drawPianoRoll,
  PIANO_ROLL_LABEL_WIDTH,
  type MarqueeRect,
} from "./drawPianoRoll";
import { hitTestPianoRollNote, hitTestPianoRollNotesInRect } from "./hitTest";
import { shouldPaintNote } from "./paint";
import { resolveSelection } from "./selection";
import {
  defaultViewportWindow,
  panBy,
  panToReveal,
  visibleTickRange,
  zoomAt,
  type ViewportWindow,
} from "./viewportWindow";

const MARQUEE_THRESHOLD_PX = 4;
const ZOOM_FACTOR_PER_WHEEL_NOTCH = 1.2;
const MARKER_HIT_RADIUS_PX = 14;

export type InteractionMode = "select" | "paint" | "range";

interface PianoRollProps {
  project: MidiProject | null;
  selectedNoteIds: ReadonlySet<string>;
  onSelectionChange: (next: ReadonlySet<string>) => void;
  soloVoiceId?: string | null;
  interactionMode?: InteractionMode;
  activeVoiceId?: string | null;
  onPaintNotes?: (noteIds: string[]) => void;
  pitchMarkers?: readonly PitchMarker[];
  onPitchMarkersChange?: (next: PitchMarker[]) => void;
  currentPlaybackTick?: number | null;
  isPlaying?: boolean;
  onSeek?: (tick: number) => void;
}

export function PianoRoll({
  project,
  selectedNoteIds,
  onSelectionChange,
  soloVoiceId = null,
  interactionMode = "select",
  activeVoiceId = null,
  onPaintNotes = () => {},
  pitchMarkers = [],
  onPitchMarkersChange = () => {},
  currentPlaybackTick = null,
  isPlaying = false,
  onSeek = () => {},
}: PianoRollProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [marqueeRect, setMarqueeRect] = useState<MarqueeRect | null>(null);
  const [viewportWindow, setViewportWindow] = useState<ViewportWindow>(defaultViewportWindow());
  const dragStartRef = useRef<{ point: { x: number; y: number }; additive: boolean } | null>(null);
  const isPaintingRef = useRef(false);
  const paintedNoteIdsRef = useRef<Map<string, string>>(new Map());
  const draggedMarkerIdRef = useRef<string | null>(null);
  const lastDurationTicksRef = useRef<number | null>(null);

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

  // Reset pan/zoom only when a genuinely new project is loaded (duration
  // changes), not on every correction — corrections replace `project`
  // with a new object reference but never change `durationTicks`.
  useEffect(() => {
    const durationTicks = project?.durationTicks ?? null;
    if (durationTicks !== lastDurationTicksRef.current) {
      lastDurationTicksRef.current = durationTicks;
      setViewportWindow(defaultViewportWindow());
    }
  }, [project?.durationTicks]);

  const tickRange = useMemo(() => {
    if (!project) {
      return undefined;
    }
    return visibleTickRange(project.durationTicks, viewportWindow);
  }, [project, viewportWindow]);

  const viewport = useMemo(
    () => buildViewport(project, size.width, size.height, tickRange),
    [project, size, tickRange],
  );

  // Bring a keyboard-selected note (e.g. review-mode Tab-stepping) into
  // view, panning only — the user's chosen zoom level is left alone.
  useEffect(() => {
    if (!project || selectedNoteIds.size !== 1) {
      return;
    }
    const [noteId] = selectedNoteIds;
    const note = project.notes.find((candidate) => candidate.id === noteId);
    if (!note) {
      return;
    }
    setViewportWindow((current) =>
      panToReveal(current, project.durationTicks, {
        startTick: note.startTick,
        endTick: note.endTick,
      }),
    );
  }, [selectedNoteIds, project]);

  // Page-follow the playhead during playback, panning only — never
  // changes zoom, and only while actually playing (a paused/stopped
  // playhead shouldn't fight a manual scroll).
  useEffect(() => {
    if (!project || !isPlaying || currentPlaybackTick === null) {
      return;
    }
    setViewportWindow((current) =>
      panToReveal(current, project.durationTicks, {
        startTick: currentPlaybackTick,
        endTick: currentPlaybackTick,
      }),
    );
  }, [project, isPlaying, currentPlaybackTick]);

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
      pitchMarkers,
      currentPlaybackTick,
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
      pitchMarkers,
      currentPlaybackTick,
    );
  }, [
    project,
    viewport,
    effectiveSelection,
    marqueeRect,
    size,
    soloVoiceId,
    pitchMarkers,
    currentPlaybackTick,
  ]);

  function pointFromEvent(event: ReactPointerEvent<HTMLCanvasElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  function markerIdFromPoint(point: { x: number; y: number }): string | null {
    if (point.x > PIANO_ROLL_LABEL_WIDTH || pitchMarkers.length === 0) {
      return null;
    }

    const nearest = pitchMarkers
      .map((marker) => ({
        marker,
        distance: Math.abs(point.y - pitchToY(marker.pitch, viewport)),
      }))
      .sort((a, b) => a.distance - b.distance)[0];

    return nearest && nearest.distance <= MARKER_HIT_RADIUS_PX ? nearest.marker.id : null;
  }

  function updateMarkerPitch(markerId: string, point: { y: number }) {
    const nextPitch = clampMidiPitch(
      Math.max(viewport.lowestPitch, Math.min(viewport.highestPitch, yToPitch(point.y, viewport))),
    );
    onPitchMarkersChange(
      pitchMarkers.map((marker) =>
        marker.id === markerId ? { ...marker, pitch: nextPitch } : marker,
      ),
    );
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (size.width <= 0 || size.height <= 0) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);

    if (interactionMode === "range") {
      const point = pointFromEvent(event);
      const markerId =
        markerIdFromPoint(point) ??
        (point.x <= PIANO_ROLL_LABEL_WIDTH ? (pitchMarkers[0]?.id ?? null) : null);
      draggedMarkerIdRef.current = markerId;
      if (markerId) {
        updateMarkerPitch(markerId, point);
      }
      return;
    }

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
    if (interactionMode === "range") {
      const markerId = draggedMarkerIdRef.current;
      if (markerId) {
        updateMarkerPitch(markerId, pointFromEvent(event));
      }
      return;
    }

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
    if (interactionMode === "range") {
      draggedMarkerIdRef.current = null;
      return;
    }

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

  // React's `onWheel` JSX prop attaches a passive native listener, so
  // `preventDefault()` inside it is silently ignored and the page would
  // still scroll/zoom natively alongside our pan/zoom. Attach a real,
  // non-passive listener directly instead.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !project) {
      return;
    }

    const targetCanvas = canvas;
    const durationTicks = project.durationTicks;

    function handleWheel(event: WheelEvent) {
      event.preventDefault();

      if (event.ctrlKey || event.metaKey) {
        const bounds = targetCanvas.getBoundingClientRect();
        const x = event.clientX - bounds.left - PIANO_ROLL_LABEL_WIDTH;
        const rollViewport = {
          ...viewport,
          width: Math.max(1, viewport.width - PIANO_ROLL_LABEL_WIDTH),
        };
        const anchorTick = xToTick(x, rollViewport);
        const factor =
          event.deltaY < 0 ? ZOOM_FACTOR_PER_WHEEL_NOTCH : 1 / ZOOM_FACTOR_PER_WHEEL_NOTCH;
        setViewportWindow((current) => zoomAt(current, durationTicks, factor, anchorTick));
        return;
      }

      const range = visibleTickRange(durationTicks, viewportWindow);
      const windowTicks = range.endTick - range.startTick;
      const rollWidth = Math.max(1, viewport.width - PIANO_ROLL_LABEL_WIDTH);
      const delta = event.deltaX !== 0 ? event.deltaX : event.deltaY;
      const panDeltaTicks = (delta / rollWidth) * windowTicks;
      setViewportWindow((current) => panBy(current, panDeltaTicks));
    }

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [project, viewport, viewportWindow]);

  function handleResetZoom() {
    setViewportWindow(defaultViewportWindow());
  }

  const minimap =
    project && tickRange
      ? {
          leftPercent: (tickRange.startTick / Math.max(1, project.durationTicks)) * 100,
          widthPercent:
            ((tickRange.endTick - tickRange.startTick) / Math.max(1, project.durationTicks)) * 100,
        }
      : null;

  function handleMinimapClick(event: ReactPointerEvent<HTMLDivElement>) {
    if (!project) {
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - bounds.left) / Math.max(1, bounds.width);
    const targetTick = ratio * project.durationTicks;
    setViewportWindow((current) =>
      panToReveal(current, project.durationTicks, { startTick: targetTick, endTick: targetTick }),
    );
    onSeek(targetTick);
  }

  return (
    <div className="piano-roll-shell" ref={containerRef}>
      {minimap ? (
        <div className="piano-roll-minimap" onPointerDown={handleMinimapClick}>
          <div
            className="piano-roll-minimap-window"
            style={{ left: `${minimap.leftPercent}%`, width: `${minimap.widthPercent}%` }}
          />
        </div>
      ) : null}
      <canvas
        ref={canvasRef}
        aria-label="Piano roll note visualization"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
      {viewportWindow.zoomLevel > 1 ? (
        <button type="button" className="piano-roll-reset-zoom" onClick={handleResetZoom}>
          Reset zoom ({viewportWindow.zoomLevel.toFixed(1)}x)
        </button>
      ) : null}
    </div>
  );
}
