import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { formatNoteTooltip, type MidiNote, type MidiProject } from "../../domain/midi/midiProject";
import { clampMidiPitch, type PitchMarker } from "../../domain/midi/rangeRules";
import { pitchToY, xToTick, yToPitch } from "./coordinates";
import {
  buildViewport,
  computeFullPitchSpan,
  drawPianoRoll,
  drawTimeRuler,
  drawVoiceLanes,
  getVoiceFillColor,
  TIME_RULER_HEIGHT,
  type MarqueeRect,
  type TickWindow,
} from "./drawPianoRoll";
import type { PianoRollPoint } from "./hitTest";
import {
  clampLaneViewport,
  defaultLaneViewportWindow,
  laneViewportAnchor,
  panLaneViewportBy,
  reconcileLaneViewport,
  resolveLaneViewport,
  revealLaneVoices,
  type LaneViewportContext,
  type LaneViewportWindow,
} from "./laneViewport";
import { resolvePencilPaintAnchor, resolveWandPaintTarget, shouldPaintNote } from "./paint";
import {
  DEFAULT_BRUSH_RADIUS,
  stepBrushRadius,
  supportsPaintTool,
  type PaintTool,
  type Point,
} from "./paintBrush";
import { drawPaintOverlay } from "./paintOverlay";
import {
  chordToleranceTicks,
  DEFAULT_WAND_REACH,
  notesInTickRange,
  selectBottomLine,
  selectChord,
  selectPhrase,
  selectTopLine,
} from "./smartSelect";
import {
  defaultPitchViewportWindow,
  panPitchBy,
  panPitchToReveal,
  visiblePitchRange,
  zoomPitchAt,
  type PitchViewportWindow,
} from "./pitchViewportWindow";
import {
  hasCrossedMarqueeThreshold,
  resolveContextAssignmentTargets,
  resolveSelection,
} from "./selection";
import {
  defaultViewportWindow,
  panBy,
  panToReveal,
  visibleTickRange,
  zoomAt,
  type ViewportWindow,
} from "./viewportWindow";
import {
  createPianoViewGeometry,
  createVoiceLaneViewGeometry,
  hitTestNoteAtPoint,
  hitTestNotesInRect,
  notesInBrushStampForView,
  notesInLassoPathForView,
} from "./viewGeometry";

const MARQUEE_THRESHOLD_PX = 4;
const ZOOM_FACTOR_PER_WHEEL_NOTCH = 1.2;
const MARKER_HIT_RADIUS_PX = 14;

export type InteractionMode = "select" | "paint" | "range";
export type PianoRollViewMode = "piano" | "voice-lanes";

export interface LinkedLaneRevealRequest {
  readonly requestId: number;
  readonly voiceId: string;
}

interface PianoRollProps {
  project: MidiProject | null;
  selectedNoteIds: ReadonlySet<string>;
  onSelectionChange: (next: ReadonlySet<string>) => void;
  soloVoiceId?: string | null;
  interactionMode?: InteractionMode;
  activeVoiceId?: string | null;
  onPaintNotes?: (noteIds: string[]) => void;
  /** Which paint sub-tool a paint-mode stroke uses. */
  paintTool?: PaintTool;
  /** Radius in px of the round brush tool's cursor/hit area. */
  brushRadius?: number;
  /** Fired by Alt+wheel over the canvas so the toolbar stays in sync. */
  onBrushRadiusChange?: (radius: number) => void;
  /** Max pitch jump (semitones) the wand's phrase flood-fill will cross. */
  wandReach?: number;
  /** Context-menu "Assign to" — reassigns notes to an explicit voice. */
  onAssignNotes?: (noteIds: string[], voiceId: string) => void;
  /** DAW-style audition: fired with the notes a click/paint gesture touched. */
  onAuditionNotes?: (notes: MidiNote[]) => void;
  /** When true, note colors show assignment confidence instead of voice. */
  confidenceHeatmap?: boolean;
  pitchMarkers?: readonly PitchMarker[];
  onPitchMarkersChange?: (next: PitchMarker[]) => void;
  currentPlaybackTick?: number | null;
  isPlaying?: boolean;
  onSeek?: (tick: number) => void;
  /** Note ids the active diff comparison reports as reassigned (Slice 4). */
  changedNoteIds?: ReadonlySet<string>;
  /** noteId -> voiceId on the diff's compared ("before") side, for the changed-note edge cue's color. */
  previousVoiceId?: ReadonlyMap<string, string>;
  /** When true, only draw notes in `changedNoteIds`. */
  onlyChangedNotes?: boolean;
  /** Read-only previews keep pan/zoom/hover but block paint and marker edits. */
  readOnly?: boolean;
  /** Optional per-voice text shown in the floating legend. */
  voiceDescriptions?: ReadonlyMap<string, string>;
  /** Note ids involved in a same-voice overlap conflict. */
  conflictNoteIds?: ReadonlySet<string>;
  viewMode?: PianoRollViewMode;
  /** Optional split-pane prefix such as "Side A" for the note canvas name. */
  accessibleLabelPrefix?: string;
  /** voiceId -> presentation key (M10), so matched voices render in a shared color. */
  presentationKeyByVoiceId?: ReadonlyMap<string, string>;
  /** Controlled horizontal (tick) viewport (M13). Omit for internal, uncontrolled state. */
  timeViewport?: ViewportWindow;
  onTimeViewportChange?: (next: ViewportWindow) => void;
  /** Controlled vertical (pitch) viewport (M13). Omit for internal, uncontrolled state. */
  pitchViewport?: PitchViewportWindow;
  onPitchViewportChange?: (next: PitchViewportWindow) => void;
  /** Controlled vertical lane viewport. Omit for internal, single-pane state. */
  laneViewport?: LaneViewportWindow;
  onLaneViewportChange?: (next: LaneViewportWindow) => void;
  /** User-origin lane navigation anchor for correspondence-aware split linking. */
  onLaneNavigationAnchor?: (voiceId: string | null) => void;
  /** Semantic target sent by the other pane; never copies a pixel offset. */
  linkedLaneReveal?: LinkedLaneRevealRequest | null;
}

export function PianoRoll({
  project,
  selectedNoteIds,
  onSelectionChange,
  soloVoiceId = null,
  interactionMode = "select",
  activeVoiceId = null,
  onPaintNotes = () => {},
  paintTool = "brush",
  brushRadius = DEFAULT_BRUSH_RADIUS,
  onBrushRadiusChange = () => {},
  wandReach = DEFAULT_WAND_REACH,
  onAssignNotes = () => {},
  onAuditionNotes = () => {},
  confidenceHeatmap = false,
  pitchMarkers = [],
  onPitchMarkersChange = () => {},
  currentPlaybackTick = null,
  isPlaying = false,
  onSeek = () => {},
  changedNoteIds = new Set(),
  previousVoiceId = new Map(),
  onlyChangedNotes = false,
  readOnly = false,
  voiceDescriptions = new Map(),
  conflictNoteIds = new Set(),
  viewMode = "piano",
  accessibleLabelPrefix,
  presentationKeyByVoiceId = new Map(),
  timeViewport,
  onTimeViewportChange,
  pitchViewport,
  onPitchViewportChange,
  laneViewport,
  onLaneViewportChange,
  onLaneNavigationAnchor,
  linkedLaneReveal = null,
}: PianoRollProps) {
  const noteCanvasLabel = accessibleLabelPrefix
    ? `${accessibleLabelPrefix} ${viewMode === "voice-lanes" ? "voice lane" : "piano roll"} note visualization`
    : viewMode === "voice-lanes"
      ? "Voice lane note visualization"
      : "Piano roll note visualization";
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rulerCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [isLegendCollapsed, setIsLegendCollapsed] = useState(false);
  const [marqueeRect, setMarqueeRect] = useState<MarqueeRect | null>(null);
  const [timeRangeDraft, setTimeRangeDraft] = useState<TickWindow | null>(null);
  const [hoveredNote, setHoveredNote] = useState<{ note: MidiNote; point: PianoRollPoint } | null>(
    null,
  );
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    noteId: string | null;
  } | null>(null);
  // The time/pitch viewports are controlled when the matching prop is provided
  // (so split panes can share one window), and otherwise owned internally --
  // an uncontrolled default that keeps single-pane behavior unchanged. Reads go
  // through `viewportWindow`/`pitchViewportWindow`; writes go through the
  // `setViewportWindow`/`setPitchViewportWindow` wrappers, so the existing
  // pan/zoom call sites are untouched.
  const [internalTimeViewport, setInternalTimeViewport] =
    useState<ViewportWindow>(defaultViewportWindow());
  const [internalPitchViewport, setInternalPitchViewport] = useState<PitchViewportWindow>(
    defaultPitchViewportWindow(),
  );
  const [internalLaneViewport, setInternalLaneViewport] = useState(defaultLaneViewportWindow);
  const viewportWindow = timeViewport ?? internalTimeViewport;
  const pitchViewportWindow = pitchViewport ?? internalPitchViewport;
  const laneViewportWindow = laneViewport ?? internalLaneViewport;
  const laneViewportWindowRef = useRef(laneViewportWindow);
  laneViewportWindowRef.current = laneViewportWindow;
  const laneViewportControlledRef = useRef(laneViewport !== undefined);
  laneViewportControlledRef.current = laneViewport !== undefined;
  const onLaneViewportChangeRef = useRef(onLaneViewportChange);
  onLaneViewportChangeRef.current = onLaneViewportChange;
  const onLaneNavigationAnchorRef = useRef(onLaneNavigationAnchor);
  onLaneNavigationAnchorRef.current = onLaneNavigationAnchor;
  const setViewportWindow = useCallback(
    (update: ViewportWindow | ((current: ViewportWindow) => ViewportWindow)) => {
      if (timeViewport !== undefined) {
        onTimeViewportChange?.(typeof update === "function" ? update(timeViewport) : update);
      } else {
        setInternalTimeViewport(update);
      }
    },
    [timeViewport, onTimeViewportChange],
  );
  const setPitchViewportWindow = useCallback(
    (update: PitchViewportWindow | ((current: PitchViewportWindow) => PitchViewportWindow)) => {
      if (pitchViewport !== undefined) {
        onPitchViewportChange?.(typeof update === "function" ? update(pitchViewport) : update);
      } else {
        setInternalPitchViewport(update);
      }
    },
    [pitchViewport, onPitchViewportChange],
  );
  const dragStartRef = useRef<{
    point: { x: number; y: number };
    additive: boolean;
    movedPastThreshold: boolean;
  } | null>(null);
  const isPaintingRef = useRef(false);
  const paintedNoteIdsRef = useRef<Map<string, string>>(new Map());
  const draggedMarkerIdRef = useRef<string | null>(null);
  const timeRangeDragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startTick: number;
    moved: boolean;
  } | null>(null);
  const lastDurationTicksRef = useRef<number | null>(null);
  const previousLaneContextRef = useRef<{
    projectKey: string | null;
    context: LaneViewportContext;
  } | null>(null);
  const lastHandledLaneRevealRequestIdRef = useRef<number | null>(null);
  // Paint-cursor overlay state. All refs, not React state: the cursor and
  // an in-progress stroke update every pointer move, and the overlay
  // canvas is redrawn by its own requestAnimationFrame loop instead of
  // re-rendering the component per pixel.
  const cursorPointRef = useRef<Point | null>(null);
  const lassoPathRef = useRef<Point[]>([]);
  const lastBrushPointRef = useRef<Point | null>(null);
  const sizeHudUntilRef = useRef(0);
  const previousBrushRadiusRef = useRef(brushRadius);
  const onBrushRadiusChangeRef = useRef(onBrushRadiusChange);
  onBrushRadiusChangeRef.current = onBrushRadiusChange;

  const canvasSize = useMemo(
    () => ({ width: size.width, height: Math.max(1, size.height - TIME_RULER_HEIGHT) }),
    [size],
  );
  const laneViewportContext = useMemo<LaneViewportContext>(
    () => ({
      voiceIds: project?.voices.map((voice) => voice.id) ?? [],
      viewportHeight: canvasSize.height,
    }),
    [project?.voices, canvasSize.height],
  );
  const laneViewportContextRef = useRef(laneViewportContext);
  laneViewportContextRef.current = laneViewportContext;
  const commitLaneViewport = useCallback(
    (
      update: LaneViewportWindow | ((current: LaneViewportWindow) => LaneViewportWindow),
      origin: "silent" | "user" = "silent",
    ) => {
      const current = laneViewportWindowRef.current;
      const context = laneViewportContextRef.current;
      const requested = typeof update === "function" ? update(current) : update;
      const next = clampLaneViewport(requested, context.voiceIds.length, context.viewportHeight);
      if (next.scrollTopPx === current.scrollTopPx) {
        return;
      }

      laneViewportWindowRef.current = next;
      if (laneViewportControlledRef.current) {
        onLaneViewportChangeRef.current?.(next);
      } else {
        setInternalLaneViewport(next);
      }
      if (origin === "user") {
        onLaneNavigationAnchorRef.current?.(laneViewportAnchor(next, context));
      }
    },
    [],
  );
  const resolvedLaneViewport = useMemo(
    () =>
      resolveLaneViewport(
        laneViewportWindow,
        laneViewportContext.voiceIds.length,
        laneViewportContext.viewportHeight,
      ),
    [laneViewportWindow, laneViewportContext],
  );
  const laneProjectKey = project
    ? [project.fileName, project.durationTicks, project.ppq, project.trackCount].join("\u0000")
    : null;

  // A brush sweep can stamp several notes per pointer sample; auditioning
  // every one would machine-gun. One blip per ~70ms keeps a swept run
  // audible as a run without the noise.
  const lastAuditionAtRef = useRef(0);
  function auditionThrottled(notes: MidiNote[]) {
    const now = performance.now();
    if (now - lastAuditionAtRef.current < 70) {
      return;
    }
    lastAuditionAtRef.current = now;
    onAuditionNotes(notes);
  }

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
      setPitchViewportWindow(defaultPitchViewportWindow());
    }
  }, [project?.durationTicks]);

  // Lane scroll is pane presentation state. A new import starts at the top;
  // resize and voice-order changes preserve the top semantic voice where
  // possible, then clamp so removed rows cannot leave a blank viewport.
  useEffect(() => {
    const previous = previousLaneContextRef.current;
    previousLaneContextRef.current = {
      projectKey: laneProjectKey,
      context: laneViewportContext,
    };
    commitLaneViewport((current) => {
      if (!previous || previous.projectKey !== laneProjectKey) {
        return current.scrollTopPx === 0 ? current : defaultLaneViewportWindow();
      }
      return reconcileLaneViewport(current, previous.context, laneViewportContext);
    });
  }, [laneProjectKey, laneViewportContext, commitLaneViewport]);

  useEffect(() => {
    if (
      viewMode !== "voice-lanes" ||
      !linkedLaneReveal ||
      lastHandledLaneRevealRequestIdRef.current === linkedLaneReveal.requestId ||
      !laneViewportContext.voiceIds.includes(linkedLaneReveal.voiceId)
    ) {
      return;
    }

    lastHandledLaneRevealRequestIdRef.current = linkedLaneReveal.requestId;
    commitLaneViewport((current) =>
      revealLaneVoices(current, [linkedLaneReveal.voiceId], laneViewportContext),
    );
  }, [linkedLaneReveal, viewMode, laneViewportContext, commitLaneViewport]);

  const interactionProject = useMemo(() => {
    if (!project || !onlyChangedNotes) {
      return project;
    }
    return {
      ...project,
      notes: project.notes.filter((note) => changedNoteIds.has(note.id)),
    };
  }, [project, onlyChangedNotes, changedNoteIds]);

  const tickRange = useMemo(() => {
    if (!project) {
      return undefined;
    }
    return visibleTickRange(project.durationTicks, viewportWindow);
  }, [project, viewportWindow]);

  const fullPitchSpan = useMemo(() => computeFullPitchSpan(project), [project]);

  const pitchRange = useMemo(() => {
    if (!project) {
      return undefined;
    }
    return visiblePitchRange(fullPitchSpan, pitchViewportWindow);
  }, [project, fullPitchSpan, pitchViewportWindow]);

  const viewport = useMemo(
    () => buildViewport(project, canvasSize.width, canvasSize.height, tickRange, pitchRange),
    [project, canvasSize, tickRange, pitchRange],
  );
  const viewGeometry = useMemo(
    () =>
      viewMode === "voice-lanes"
        ? createVoiceLaneViewGeometry(project, viewport, resolvedLaneViewport)
        : createPianoViewGeometry(project, viewport),
    [viewMode, project, viewport, resolvedLaneViewport],
  );
  const viewGeometryRef = useRef(viewGeometry);
  viewGeometryRef.current = viewGeometry;
  const isPaintCursorActive =
    interactionMode === "paint" &&
    !readOnly &&
    supportsPaintTool(viewGeometry.capabilities, paintTool);
  const isPitchRangeGestureActive =
    viewGeometry.capabilities.pitchRangeMarkers && interactionMode === "range" && !readOnly;

  // Bring a selected note/group (review stepping, conflict jumps) into
  // view, panning only — the user's chosen zoom level is left alone.
  useEffect(() => {
    if (!project || selectedNoteIds.size === 0) {
      return;
    }
    const notes = project.notes.filter((candidate) => selectedNoteIds.has(candidate.id));
    if (notes.length === 0) {
      return;
    }
    const revealTarget = viewGeometryRef.current.revealTarget(notes);
    if (!revealTarget) {
      return;
    }
    setViewportWindow((current) => panToReveal(current, project.durationTicks, revealTarget));
    const verticalTarget = revealTarget.vertical;
    if (verticalTarget.kind === "pitch") {
      setPitchViewportWindow((current) => panPitchToReveal(current, fullPitchSpan, verticalTarget));
    } else {
      commitLaneViewport((current) =>
        revealLaneVoices(current, verticalTarget.voiceIds, laneViewportContext),
      );
    }
  }, [selectedNoteIds, project, fullPitchSpan, viewMode, laneViewportContext, commitLaneViewport]);

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
    return hitTestNotesInRect(marqueeRect, interactionProject?.notes ?? [], viewGeometry).map(
      (note) => note.id,
    );
  }, [marqueeRect, interactionProject, viewGeometry]);

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

  function hitTestActiveNote(point: PianoRollPoint): MidiNote | null {
    return hitTestNoteAtPoint(point, interactionProject?.notes ?? [], viewGeometry);
  }

  const contextNote = useMemo(() => {
    if (!contextMenu?.noteId || !interactionProject) {
      return null;
    }
    return interactionProject.notes.find((note) => note.id === contextMenu.noteId) ?? null;
  }, [contextMenu, interactionProject]);

  const authorizedSelectedNoteIds = useMemo(
    () =>
      interactionProject?.notes
        .filter((note) => selectedNoteIds.has(note.id))
        .map((note) => note.id) ?? [],
    [interactionProject, selectedNoteIds],
  );

  // DAW convention: a right-click on a selected note acts on the whole
  // selection; on an unselected note, just that note; on empty space, the
  // selection (if any).
  const assignTargetIds = useMemo(() => {
    if (!contextMenu) {
      return [];
    }
    return resolveContextAssignmentTargets(
      contextMenu.noteId,
      selectedNoteIds,
      interactionProject?.notes.map((note) => note.id) ?? [],
    );
  }, [contextMenu, selectedNoteIds, interactionProject]);

  function drawCurrentView(context: CanvasRenderingContext2D) {
    if (viewMode === "voice-lanes") {
      drawVoiceLanes(
        context,
        project,
        viewport,
        viewGeometry,
        effectiveSelection,
        marqueeRect,
        soloVoiceId,
        paintedNoteIdsRef.current,
        currentPlaybackTick,
        changedNoteIds,
        previousVoiceId,
        onlyChangedNotes,
        confidenceHeatmap,
        presentationKeyByVoiceId,
      );
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
      changedNoteIds,
      previousVoiceId,
      onlyChangedNotes,
      confidenceHeatmap,
      conflictNoteIds,
      timeRangeDraft,
      presentationKeyByVoiceId,
    );
  }
  function redrawCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    drawCurrentView(context);
  }
  // Effects (stroke cleanup, Escape cancel) need to trigger a redraw
  // without listing the per-render `redrawCanvas` closure as a dependency,
  // which would re-run them every render.
  const redrawCanvasRef = useRef(redrawCanvas);
  redrawCanvasRef.current = redrawCanvas;

  function cancelPaintStroke() {
    isPaintingRef.current = false;
    lassoPathRef.current = [];
    lastBrushPointRef.current = null;
    if (paintedNoteIdsRef.current.size > 0) {
      paintedNoteIdsRef.current = new Map();
      redrawCanvasRef.current();
    }
  }
  const cancelPaintStrokeRef = useRef(cancelPaintStroke);
  cancelPaintStrokeRef.current = cancelPaintStroke;

  /**
   * Adds (or with `erase`, removes) every note under a brush capsule swept
   * from `from` to `to` to the in-progress stroke, live-previewing on the
   * main canvas when membership changed.
   */
  function stampBrush(from: Point, to: Point, erase: boolean) {
    if (!activeVoiceId) {
      return;
    }
    const hits = notesInBrushStampForView(
      from,
      to,
      brushRadius,
      interactionProject?.notes ?? [],
      viewGeometry,
    );
    const alreadyPainted = new Set(paintedNoteIdsRef.current.keys());
    const newlyPainted: MidiNote[] = [];
    let changed = false;
    for (const note of hits) {
      if (erase) {
        changed = paintedNoteIdsRef.current.delete(note.id) || changed;
      } else if (shouldPaintNote(note, activeVoiceId, alreadyPainted)) {
        paintedNoteIdsRef.current.set(note.id, activeVoiceId);
        alreadyPainted.add(note.id);
        newlyPainted.push(note);
        changed = true;
      }
    }
    if (changed) {
      redrawCanvas();
    }
    if (newlyPainted.length > 0) {
      auditionThrottled([newlyPainted[0]]);
    }
  }

  /**
   * The wand's stamp: flood-fills the connected melodic phrase around the
   * note under the cursor into the in-progress stroke. Dragging stamps
   * each newly touched note's phrase additively, like dragging Photoshop's
   * wand with Shift held.
   */
  function stampWand(point: Point) {
    if (!activeVoiceId || !interactionProject) {
      return;
    }
    const target = resolveWandPaintTarget(
      point,
      interactionProject.notes,
      viewGeometry,
      interactionProject.ppq,
      wandReach,
    );
    if (!target || paintedNoteIdsRef.current.has(target.anchor.id)) {
      return;
    }
    let changed = false;
    for (const phraseNote of target.phrase) {
      if (phraseNote.voiceId !== activeVoiceId && !paintedNoteIdsRef.current.has(phraseNote.id)) {
        paintedNoteIdsRef.current.set(phraseNote.id, activeVoiceId);
        changed = true;
      }
    }
    if (changed) {
      redrawCanvas();
      // The anchor, not the whole phrase — one blip tells you the fill
      // landed; a full run would replay the melody on every click.
      auditionThrottled([target.anchor]);
    }
  }

  /**
   * Recomputes which notes the in-progress lasso encloses and previews
   * them. The pending set is rebuilt from scratch each move (not
   * accumulated like brush stamps) so backing out of a region un-previews
   * its notes.
   */
  function updateLassoPreview() {
    if (!activeVoiceId) {
      return;
    }
    const enclosed = notesInLassoPathForView(
      lassoPathRef.current,
      interactionProject?.notes ?? [],
      viewGeometry,
    );
    const next = new Map<string, string>();
    for (const note of enclosed) {
      if (note.voiceId !== activeVoiceId) {
        next.set(note.id, activeVoiceId);
      }
    }
    const current = paintedNoteIdsRef.current;
    const changed = next.size !== current.size || [...next.keys()].some((id) => !current.has(id));
    paintedNoteIdsRef.current = next;
    if (changed) {
      redrawCanvas();
    }
  }

  // Leaving paint mode (or switching to a read-only preview) mid-stroke
  // must discard the uncommitted preview, or its colors would linger on
  // the canvas without any real assignment behind them.
  useEffect(() => {
    if (!isPaintCursorActive) {
      cancelPaintStrokeRef.current();
    }
  }, [isPaintCursorActive]);

  // Escape cancels an in-progress stroke (App-level Escape handling then
  // also exits paint mode — a mid-stroke Escape is "get me out").
  useEffect(() => {
    if (!isPaintCursorActive) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && isPaintingRef.current) {
        cancelPaintStrokeRef.current();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPaintCursorActive]);

  // Flash the brush-size HUD near the cursor whenever the radius changes,
  // whichever control changed it (slider, [ ] keys, Alt+wheel).
  useEffect(() => {
    if (previousBrushRadiusRef.current !== brushRadius) {
      previousBrushRadiusRef.current = brushRadius;
      sizeHudUntilRef.current = performance.now() + 900;
    }
  }, [brushRadius]);

  // The overlay animation loop: draws the tool cursor, in-progress lasso
  // (marching ants), and size HUD every frame while paint mode is active.
  // Runs off refs so pointer moves never re-render the component.
  useEffect(() => {
    const overlay = overlayCanvasRef.current;
    const overlayContext = overlay?.getContext("2d");
    if (!overlay || !overlayContext) {
      return;
    }

    if (!isPaintCursorActive) {
      overlayContext.save();
      overlayContext.setTransform(1, 0, 0, 1, 0, 0);
      overlayContext.clearRect(0, 0, overlay.width, overlay.height);
      overlayContext.restore();
      return;
    }

    let rafId = 0;
    const voiceColor = activeVoiceId ? getVoiceFillColor(activeVoiceId) : null;
    function drawFrame(time: number) {
      if (overlayContext) {
        drawPaintOverlay(overlayContext, canvasSize.width, canvasSize.height, {
          tool: paintTool,
          cursor: cursorPointRef.current,
          brushRadius,
          voiceColor,
          lassoPath: lassoPathRef.current,
          antsPhase: time / 20,
          sizeHudOpacity: Math.max(
            0,
            Math.min(1, (sizeHudUntilRef.current - performance.now()) / 300),
          ),
        });
      }
      rafId = requestAnimationFrame(drawFrame);
    }
    rafId = requestAnimationFrame(drawFrame);
    return () => cancelAnimationFrame(rafId);
  }, [isPaintCursorActive, paintTool, brushRadius, activeVoiceId, canvasSize]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvasSize.width <= 0 || canvasSize.height <= 0) {
      return;
    }

    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(canvasSize.width * ratio);
    canvas.height = Math.floor(canvasSize.height * ratio);
    canvas.style.width = `${canvasSize.width}px`;
    canvas.style.height = `${canvasSize.height}px`;

    const ruler = rulerCanvasRef.current;
    if (ruler) {
      ruler.width = Math.floor(canvasSize.width * ratio);
      ruler.height = Math.floor(TIME_RULER_HEIGHT * ratio);
      ruler.style.width = `${canvasSize.width}px`;
      ruler.style.height = `${TIME_RULER_HEIGHT}px`;
      const rulerContext = ruler.getContext("2d");
      if (rulerContext) {
        rulerContext.setTransform(ratio, 0, 0, ratio, 0, 0);
        drawTimeRuler(
          rulerContext,
          viewport,
          project?.ppq ?? 480,
          currentPlaybackTick,
          timeRangeDraft,
          viewGeometry.gutterWidth,
        );
      }
    }

    const overlay = overlayCanvasRef.current;
    if (overlay) {
      overlay.width = Math.floor(canvasSize.width * ratio);
      overlay.height = Math.floor(canvasSize.height * ratio);
      overlay.style.width = `${canvasSize.width}px`;
      overlay.style.height = `${canvasSize.height}px`;
      // Pin the absolutely-positioned overlay exactly over the in-flow
      // canvas (which sits below the shell's minimap padding band).
      overlay.style.top = `${canvas.offsetTop}px`;
      overlay.style.left = `${canvas.offsetLeft}px`;
      overlay.getContext("2d")?.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawCurrentView(context);
  }, [
    project,
    viewport,
    effectiveSelection,
    marqueeRect,
    canvasSize,
    size,
    soloVoiceId,
    pitchMarkers,
    currentPlaybackTick,
    changedNoteIds,
    previousVoiceId,
    onlyChangedNotes,
    confidenceHeatmap,
    conflictNoteIds,
    timeRangeDraft,
    viewMode,
    viewGeometry,
  ]);

  function pointFromEvent(event: ReactPointerEvent<HTMLCanvasElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  function tickFromRulerEvent(event: ReactPointerEvent<HTMLCanvasElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const gutterWidth = viewGeometry.gutterWidth;
    const rollViewport = {
      ...viewport,
      width: Math.max(1, viewport.width - gutterWidth),
    };
    const rawTick = xToTick(event.clientX - bounds.left - gutterWidth, rollViewport);
    return Math.max(viewport.startTick, Math.min(viewport.endTick, rawTick));
  }

  function handleRulerPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0 || !project) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const tick = tickFromRulerEvent(event);
    timeRangeDragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startTick: tick,
      moved: false,
    };
    if (!readOnly) {
      setTimeRangeDraft({ startTick: tick, endTick: tick });
    }
  }

  function handleRulerPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const drag = timeRangeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const moved = Math.abs(event.clientX - drag.startClientX) >= MARQUEE_THRESHOLD_PX;
    drag.moved = drag.moved || moved;
    if (!readOnly && drag.moved) {
      const endTick = tickFromRulerEvent(event);
      setTimeRangeDraft({ startTick: drag.startTick, endTick });
      if (interactionProject) {
        const notes = notesInTickRange(interactionProject.notes, drag.startTick, endTick);
        onSelectionChange(new Set(notes.map((note) => note.id)));
      }
    }
  }

  function finishRulerGesture(event: ReactPointerEvent<HTMLCanvasElement>) {
    const drag = timeRangeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const endTick = tickFromRulerEvent(event);
    drag.moved = drag.moved || Math.abs(event.clientX - drag.startClientX) >= MARQUEE_THRESHOLD_PX;
    timeRangeDragRef.current = null;
    setTimeRangeDraft(null);

    if (!drag.moved) {
      onSeek(endTick);
      return;
    }
    if (readOnly || !interactionProject) {
      return;
    }
    const notes = notesInTickRange(interactionProject.notes, drag.startTick, endTick);
    onSelectionChange(new Set(notes.map((note) => note.id)));
  }

  function handleRulerPointerCancel(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (timeRangeDragRef.current?.pointerId === event.pointerId) {
      timeRangeDragRef.current = null;
      setTimeRangeDraft(null);
    }
  }
  function markerIdFromPoint(point: { x: number; y: number }): string | null {
    if (point.x > viewGeometry.gutterWidth || pitchMarkers.length === 0) {
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
    // Only the primary button starts a gesture — a right-click opens the
    // context menu (its own event) and must not paint or start a marquee.
    if (event.button !== 0 || size.width <= 0 || size.height <= 0) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    setHoveredNote(null);
    setContextMenu(null);

    if (isPitchRangeGestureActive) {
      const point = pointFromEvent(event);
      const markerId =
        markerIdFromPoint(point) ??
        (point.x <= viewGeometry.gutterWidth ? (pitchMarkers[0]?.id ?? null) : null);
      draggedMarkerIdRef.current = markerId;
      if (markerId) {
        updateMarkerPitch(markerId, point);
      }
      return;
    }

    if (isPaintCursorActive) {
      const point = pointFromEvent(event);
      cursorPointRef.current = point;
      if (!activeVoiceId) {
        return;
      }
      isPaintingRef.current = true;
      paintedNoteIdsRef.current = new Map();
      if (paintTool === "brush") {
        lastBrushPointRef.current = point;
        stampBrush(point, point, event.altKey);
      } else if (paintTool === "lasso") {
        lassoPathRef.current = [point];
      } else if (paintTool === "wand") {
        stampWand(point);
      } else {
        const note = resolvePencilPaintAnchor(point, interactionProject?.notes ?? [], viewGeometry);
        if (note && shouldPaintNote(note, activeVoiceId, new Set())) {
          paintedNoteIdsRef.current.set(note.id, activeVoiceId);
          redrawCanvas();
          auditionThrottled([note]);
        }
      }
      return;
    }

    dragStartRef.current = {
      point: pointFromEvent(event),
      additive: event.shiftKey,
      movedPastThreshold: false,
    };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (isPitchRangeGestureActive) {
      const markerId = draggedMarkerIdRef.current;
      if (markerId) {
        updateMarkerPitch(markerId, pointFromEvent(event));
      }
      return;
    }

    if (isPaintCursorActive) {
      const point = pointFromEvent(event);
      cursorPointRef.current = point;
      if (!isPaintingRef.current || !activeVoiceId) {
        return;
      }
      if (paintTool === "brush") {
        stampBrush(lastBrushPointRef.current ?? point, point, event.altKey);
        lastBrushPointRef.current = point;
      } else if (paintTool === "wand") {
        stampWand(point);
      } else if (paintTool === "lasso") {
        const path = lassoPathRef.current;
        const last = path[path.length - 1];
        // Skip sub-3px jitter so the polygon stays small and smooth.
        if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= 3) {
          path.push(point);
          updateLassoPreview();
        }
      } else {
        const note = resolvePencilPaintAnchor(point, interactionProject?.notes ?? [], viewGeometry);
        if (
          note &&
          shouldPaintNote(note, activeVoiceId, new Set(paintedNoteIdsRef.current.keys()))
        ) {
          paintedNoteIdsRef.current.set(note.id, activeVoiceId);
          redrawCanvas();
          auditionThrottled([note]);
        }
      }
      return;
    }

    const dragStart = dragStartRef.current;
    if (!dragStart) {
      const point = pointFromEvent(event);
      const note = hitTestActiveNote(point);
      setHoveredNote(note ? { note, point } : null);
      return;
    }

    const point = pointFromEvent(event);
    dragStart.movedPastThreshold = hasCrossedMarqueeThreshold(
      dragStart.point,
      point,
      MARQUEE_THRESHOLD_PX,
      dragStart.movedPastThreshold,
    );

    if (dragStart.movedPastThreshold) {
      setMarqueeRect({ x0: dragStart.point.x, y0: dragStart.point.y, x1: point.x, y1: point.y });
    }
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0) {
      return;
    }

    if (isPitchRangeGestureActive) {
      draggedMarkerIdRef.current = null;
      return;
    }

    if (isPaintCursorActive) {
      if (isPaintingRef.current) {
        isPaintingRef.current = false;
        lassoPathRef.current = [];
        lastBrushPointRef.current = null;
        const paintedIds = Array.from(paintedNoteIdsRef.current.keys());
        paintedNoteIdsRef.current = new Map();
        if (paintedIds.length > 0) {
          onPaintNotes(paintedIds);
        } else {
          // A stroke can end with an empty pending set while the canvas
          // still shows preview colors (e.g. a lasso opened around notes
          // and then dragged back off them, or an Alt-erase of the whole
          // stroke) — repaint to drop the preview.
          redrawCanvas();
        }
      }
      return;
    }

    const dragStart = dragStartRef.current;
    if (!dragStart) {
      return;
    }

    const point = pointFromEvent(event);

    dragStart.movedPastThreshold = hasCrossedMarqueeThreshold(
      dragStart.point,
      point,
      MARQUEE_THRESHOLD_PX,
      dragStart.movedPastThreshold,
    );

    if (dragStart.movedPastThreshold) {
      const noteIds = hitTestNotesInRect(
        { x0: dragStart.point.x, y0: dragStart.point.y, x1: point.x, y1: point.y },
        interactionProject?.notes ?? [],
        viewGeometry,
      ).map((note) => note.id);
      onSelectionChange(
        resolveSelection(selectedNoteIds, {
          type: "marquee",
          noteIds,
          additive: dragStart.additive,
        }),
      );
    } else {
      const note = hitTestActiveNote(point);
      if (note) {
        auditionThrottled([note]);
      }
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

  function handleCanvasPointerCancel() {
    dragStartRef.current = null;
    setMarqueeRect(null);
  }

  function pointFromMouseEvent(event: ReactMouseEvent<HTMLCanvasElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  function handleCanvasContextMenu(event: ReactMouseEvent<HTMLCanvasElement>) {
    // Always suppress the browser menu over the roll — a right-click that
    // can't open our menu should do nothing, not pop "Save image as...".
    event.preventDefault();
    if (readOnly || !viewGeometry.capabilities.contextActions || !interactionProject) {
      return;
    }
    const point = pointFromMouseEvent(event);
    const note = hitTestActiveNote(point);
    if (!note && authorizedSelectedNoteIds.length === 0) {
      setContextMenu(null);
      return;
    }
    setHoveredNote(null);
    setContextMenu({ x: point.x, y: point.y, noteId: note?.id ?? null });
  }

  function handleCanvasDoubleClick(event: ReactMouseEvent<HTMLCanvasElement>) {
    if (
      !viewGeometry.capabilities.clickSelection ||
      interactionMode !== "select" ||
      !interactionProject
    ) {
      return;
    }
    const note = hitTestActiveNote(pointFromMouseEvent(event));
    if (!note) {
      return;
    }
    const chord = selectChord(
      note,
      interactionProject.notes,
      chordToleranceTicks(interactionProject.ppq),
    );
    // Deliberately unthrottled: the preceding click's single-note blip
    // would otherwise suppress hearing the chord itself — the whole point
    // of double-clicking it.
    if (viewGeometry.capabilities.audition) {
      onAuditionNotes(chord);
    }
    onSelectionChange(new Set(chord.map((chordNote) => chordNote.id)));
  }

  function handleMenuSelectChord() {
    if (!contextNote || !interactionProject) {
      return;
    }
    const chord = selectChord(
      contextNote,
      interactionProject.notes,
      chordToleranceTicks(interactionProject.ppq),
    );
    onSelectionChange(new Set(chord.map((note) => note.id)));
    setContextMenu(null);
  }

  function handleMenuSelectPhrase() {
    if (!contextNote || !interactionProject) {
      return;
    }
    const phrase = selectPhrase(contextNote, interactionProject.notes, {
      maxGapTicks: interactionProject.ppq,
      maxPitchJumpSemitones: wandReach,
    });
    onSelectionChange(new Set(phrase.map((note) => note.id)));
    setContextMenu(null);
  }

  function handleMenuKeepLine(edge: "top" | "bottom") {
    if (!interactionProject) {
      return;
    }
    const selectedNotes = interactionProject.notes.filter((note) => selectedNoteIds.has(note.id));
    const line = edge === "top" ? selectTopLine(selectedNotes) : selectBottomLine(selectedNotes);
    onSelectionChange(new Set(line.map((note) => note.id)));
    setContextMenu(null);
  }

  function handleMenuAssign(voiceId: string) {
    if (assignTargetIds.length > 0) {
      onAssignNotes(assignTargetIds, voiceId);
    }
    setContextMenu(null);
  }

  useEffect(() => {
    if (!contextMenu) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [contextMenu]);

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

      // Alt+wheel resizes the paint brush (Photoshop-style) instead of
      // panning/zooming, but only while the brush cursor is actually up.
      if (event.altKey && isPaintCursorActive && paintTool === "brush") {
        onBrushRadiusChangeRef.current(stepBrushRadius(brushRadius, event.deltaY < 0 ? 1 : -1));
        return;
      }

      const isModified = event.ctrlKey || event.metaKey;

      if (event.shiftKey && viewGeometry.capabilities.verticalAxis === "lanes") {
        const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX;
        commitLaneViewport(
          (current) => panLaneViewportBy(current, delta, laneViewportContext),
          "user",
        );
        return;
      }

      if (isModified && event.shiftKey) {
        const bounds = targetCanvas.getBoundingClientRect();
        const anchorPitch = yToPitch(event.clientY - bounds.top, viewport);
        const factor =
          event.deltaY < 0 ? ZOOM_FACTOR_PER_WHEEL_NOTCH : 1 / ZOOM_FACTOR_PER_WHEEL_NOTCH;
        setPitchViewportWindow((current) =>
          zoomPitchAt(current, fullPitchSpan, factor, anchorPitch),
        );
        return;
      }

      if (isModified) {
        const bounds = targetCanvas.getBoundingClientRect();
        const gutterWidth = viewGeometry.gutterWidth;
        const x = event.clientX - bounds.left - gutterWidth;
        const rollViewport = {
          ...viewport,
          width: Math.max(1, viewport.width - gutterWidth),
        };
        const anchorTick = xToTick(x, rollViewport);
        const factor =
          event.deltaY < 0 ? ZOOM_FACTOR_PER_WHEEL_NOTCH : 1 / ZOOM_FACTOR_PER_WHEEL_NOTCH;
        setViewportWindow((current) => zoomAt(current, durationTicks, factor, anchorTick));
        return;
      }

      if (event.shiftKey) {
        const pitchSpan = visiblePitchRange(fullPitchSpan, pitchViewportWindow);
        const windowPitches = pitchSpan.highestPitch - pitchSpan.lowestPitch + 1;
        // A plain vertical mouse wheel held with Shift is commonly
        // remapped by the OS into a horizontal scroll (deltaX populated,
        // deltaY zeroed) before this handler ever sees it — the same
        // quirk the horizontal-pan branch below already works around.
        // Prefer deltaY (untouched trackpad scroll) but fall back to
        // deltaX (OS-remapped mouse wheel).
        const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX;
        // Negated: pitch increases upward on screen (lower y = higher
        // pitch), the opposite of tick/x, so scrolling "down" (positive
        // delta) should reveal lower pitches, not higher ones.
        const panDeltaPitches = -(delta / Math.max(1, viewport.height)) * windowPitches;
        setPitchViewportWindow((current) => panPitchBy(current, panDeltaPitches));
        return;
      }

      const range = visibleTickRange(durationTicks, viewportWindow);
      const windowTicks = range.endTick - range.startTick;
      const rollWidth = Math.max(1, viewport.width - viewGeometry.gutterWidth);
      const delta = event.deltaX !== 0 ? event.deltaX : event.deltaY;
      const panDeltaTicks = (delta / rollWidth) * windowTicks;
      setViewportWindow((current) => panBy(current, panDeltaTicks));
    }

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [
    project,
    viewport,
    viewportWindow,
    pitchViewportWindow,
    fullPitchSpan,
    isPaintCursorActive,
    paintTool,
    brushRadius,
    viewGeometry,
    laneViewportContext,
    commitLaneViewport,
  ]);

  function handleResetView() {
    setViewportWindow(defaultViewportWindow());
    setPitchViewportWindow(defaultPitchViewportWindow());
    commitLaneViewport(defaultLaneViewportWindow(), "user");
  }

  const isHorizontallyZoomed = viewportWindow.zoomLevel > 1;
  const isVerticallyZoomed = pitchViewportWindow.zoomLevel > 1;
  const isLaneScrolled = viewMode === "voice-lanes" && resolvedLaneViewport.scrollTopPx > 0;
  const resetZoomLabel =
    isHorizontallyZoomed && isVerticallyZoomed
      ? `H ${viewportWindow.zoomLevel.toFixed(1)}x · V ${pitchViewportWindow.zoomLevel.toFixed(1)}x`
      : isVerticallyZoomed
        ? `${pitchViewportWindow.zoomLevel.toFixed(1)}x`
        : `${viewportWindow.zoomLevel.toFixed(1)}x`;
  const resetViewLabel = isLaneScrolled
    ? isHorizontallyZoomed || isVerticallyZoomed
      ? `Reset view (${resetZoomLabel} · lanes)`
      : "Reset view (lanes)"
    : `Reset zoom (${resetZoomLabel})`;
  const laneAnchorVoiceId = laneViewportAnchor(
    { scrollTopPx: resolvedLaneViewport.scrollTopPx },
    laneViewportContext,
  );
  const laneAnchorIndex = laneAnchorVoiceId
    ? laneViewportContext.voiceIds.indexOf(laneAnchorVoiceId)
    : -1;
  const laneAnchorLabel = project?.voices.find((voice) => voice.id === laneAnchorVoiceId)?.label;
  const laneScrollValueText = laneAnchorLabel
    ? `${laneAnchorLabel}, lane ${laneAnchorIndex + 1} of ${laneViewportContext.voiceIds.length} at top`
    : "No voice lanes";

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
    <div
      className={[
        "piano-roll-shell",
        isPaintCursorActive ? "paint-cursor-active" : "",
        viewMode === "voice-lanes" ? "voice-lane-view" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      ref={containerRef}
    >
      {minimap ? (
        <div
          className="piano-roll-minimap"
          style={{ left: viewGeometry.gutterWidth }}
          onPointerDown={handleMinimapClick}
        >
          <div
            className="piano-roll-minimap-window"
            style={{ left: `${minimap.leftPercent}%`, width: `${minimap.widthPercent}%` }}
          />
        </div>
      ) : null}
      <canvas
        ref={rulerCanvasRef}
        className="piano-roll-time-ruler"
        aria-label="Time ruler range selection"
        onPointerDown={handleRulerPointerDown}
        onPointerMove={handleRulerPointerMove}
        onPointerUp={finishRulerGesture}
        onPointerCancel={handleRulerPointerCancel}
      />{" "}
      <canvas
        ref={canvasRef}
        aria-label={noteCanvasLabel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handleCanvasPointerCancel}
        onContextMenu={handleCanvasContextMenu}
        onDoubleClick={handleCanvasDoubleClick}
        onPointerLeave={() => {
          setHoveredNote(null);
          cursorPointRef.current = null;
        }}
      />
      <canvas ref={overlayCanvasRef} className="piano-roll-paint-overlay" aria-hidden="true" />
      {viewMode === "voice-lanes" && project && project.voices.length > 0 ? (
        <input
          className="voice-lane-scroll-control"
          type="range"
          min={0}
          max={resolvedLaneViewport.maxScrollTopPx}
          step={1}
          value={resolvedLaneViewport.scrollTopPx}
          disabled={resolvedLaneViewport.maxScrollTopPx === 0}
          aria-label="Voice lane vertical scroll"
          aria-orientation="vertical"
          aria-valuetext={laneScrollValueText}
          onChange={(event) =>
            commitLaneViewport({ scrollTopPx: Number(event.currentTarget.value) }, "user")
          }
        />
      ) : null}
      {hoveredNote && project ? (
        <div
          className="piano-roll-tooltip"
          style={{ left: hoveredNote.point.x + 14, top: hoveredNote.point.y + 14 }}
        >
          {formatNoteTooltip(hoveredNote.note, project.voices)}
        </div>
      ) : null}
      {contextMenu && project ? (
        <>
          <div
            className="piano-roll-context-backdrop"
            onPointerDown={() => setContextMenu(null)}
            onContextMenu={(event) => {
              event.preventDefault();
              setContextMenu(null);
            }}
          />
          <div
            className="piano-roll-context-menu"
            role="menu"
            aria-label="Note actions"
            style={{
              left: Math.min(contextMenu.x, Math.max(0, size.width - 210)),
              top: Math.min(contextMenu.y + 8, Math.max(0, size.height - 180)),
            }}
          >
            {contextNote ? (
              <>
                <button type="button" role="menuitem" onClick={handleMenuSelectChord}>
                  Select chord
                </button>
                <button type="button" role="menuitem" onClick={handleMenuSelectPhrase}>
                  Select phrase
                </button>
              </>
            ) : null}
            {authorizedSelectedNoteIds.length >= 2 ? (
              <>
                <button type="button" role="menuitem" onClick={() => handleMenuKeepLine("top")}>
                  Keep top line only
                </button>
                <button type="button" role="menuitem" onClick={() => handleMenuKeepLine("bottom")}>
                  Keep bottom line only
                </button>
              </>
            ) : null}
            {assignTargetIds.length > 0 && project.voices.length > 0 ? (
              <div className="piano-roll-context-assign">
                <span className="piano-roll-context-assign-label">
                  Assign {assignTargetIds.length === 1 ? "note" : `${assignTargetIds.length} notes`}{" "}
                  to
                </span>
                <div className="piano-roll-context-swatches">
                  {project.voices.map((voice) => (
                    <button
                      key={voice.id}
                      type="button"
                      role="menuitem"
                      className="piano-roll-context-swatch"
                      title={voice.label}
                      aria-label={`Assign to ${voice.label}`}
                      style={{
                        backgroundColor: getVoiceFillColor(
                          presentationKeyByVoiceId.get(voice.id) ?? voice.id,
                        ),
                      }}
                      onClick={() => handleMenuAssign(voice.id)}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </>
      ) : null}
      {viewportWindow.zoomLevel > 1 || pitchViewportWindow.zoomLevel > 1 || isLaneScrolled ? (
        <button type="button" className="piano-roll-reset-zoom" onClick={handleResetView}>
          {resetViewLabel}
        </button>
      ) : null}
      {project && project.voices.length > 0 ? (
        <div className={isLegendCollapsed ? "piano-roll-legend collapsed" : "piano-roll-legend"}>
          <button
            type="button"
            className="piano-roll-legend-toggle"
            onClick={() => setIsLegendCollapsed((collapsed) => !collapsed)}
            aria-expanded={isLegendCollapsed ? "false" : "true"}
          >
            {isLegendCollapsed ? "Voices ▸" : "Voices ▾"}
          </button>
          {!isLegendCollapsed ? (
            <ul className="piano-roll-legend-list">
              {project.voices.map((voice) => (
                <li key={voice.id}>
                  <span
                    className="piano-roll-legend-swatch"
                    style={{ backgroundColor: getVoiceFillColor(voice.id) }}
                  />
                  <span className="piano-roll-legend-label">
                    {voice.label}
                    {voiceDescriptions.get(voice.id) ? (
                      <small>{voiceDescriptions.get(voice.id)}</small>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
