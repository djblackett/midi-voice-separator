import {
  LOW_CONFIDENCE_THRESHOLD,
  type MidiNote,
  type MidiProject,
} from "../../domain/midi/midiProject";
import type { PitchMarker } from "../../domain/midi/rangeRules";
import type { PianoRollViewport } from "../../domain/midi/viewport";
import { pitchToY, tickToX } from "./coordinates";
import {
  buildVoiceLaneLayout,
  findVoiceLane,
  voiceLaneNoteRect,
  VOICE_LANE_LABEL_WIDTH,
} from "./voiceLanes";

export const PIANO_ROLL_LABEL_WIDTH = 56;
const VOICE_COLORS = [
  "#38bdf8",
  "#a78bfa",
  "#34d399",
  "#fbbf24",
  "#fb7185",
  "#f472b6",
  "#fb923c",
  "#a3e635",
  "#22d3ee",
  "#818cf8",
  "#e879f9",
  "#2dd4bf",
];
/** Fallback for the changed-note edge cue when the previous voice isn't known (e.g. the note didn't exist on the compared side). */
const DEFAULT_CHANGE_EDGE_COLOR = "#facc15";
const CHANGE_EDGE_WIDTH_PX = 3;
/** The same-voice-overlap underline (spellcheck-style, along the note's bottom edge). */
const CONFLICT_UNDERLINE_COLOR = "#ef4444";
const CONFLICT_UNDERLINE_HEIGHT_PX = 2;
export const TIME_RULER_HEIGHT = 20;
const VOICE_STROKES = [
  "#7dd3fc",
  "#c4b5fd",
  "#86efac",
  "#fde68a",
  "#fda4af",
  "#f9a8d4",
  "#fdba74",
  "#bef264",
  "#67e8f9",
  "#a5b4fc",
  "#f0abfc",
  "#5eead6",
];

/**
 * Maps a voice id to a stable small index, shared by color (here) and
 * playback waveform (`scheduledNotes.ts`) so a voice stays recognizable
 * by ear the same way it's recognizable by eye.
 */
export function voiceColorIndex(voiceId: string): number {
  const voiceNumber = Number.parseInt(voiceId.replace("voice-", ""), 10);
  return Number.isFinite(voiceNumber) && voiceNumber > 0
    ? (voiceNumber - 1) % VOICE_COLORS.length
    : 0;
}

export function getVoiceFillColor(voiceId: string): string {
  return VOICE_COLORS[voiceColorIndex(voiceId)];
}

export function getVoiceStrokeColor(voiceId: string): string {
  return VOICE_STROKES[voiceColorIndex(voiceId)];
}

/**
 * The confidence-heatmap ("X-ray") color scale: red (confidence 0, worth
 * a look) through amber to green (confidence 1, certain/locked). Hue-only
 * interpolation keeps every step equally saturated so nothing on the dark
 * background reads as "dimmed" rather than "uncertain".
 */
export function confidenceHeatColor(confidence: number): string {
  const clamped = Math.max(0, Math.min(1, confidence));
  return `hsl(${Math.round(clamped * 140)}, 85%, 55%)`;
}

export function confidenceHeatStrokeColor(confidence: number): string {
  const clamped = Math.max(0, Math.min(1, confidence));
  return `hsl(${Math.round(clamped * 140)}, 85%, 72%)`;
}

export interface TickWindow {
  startTick: number;
  endTick: number;
}

export interface PitchWindow {
  lowestPitch: number;
  highestPitch: number;
}

export function buildViewport(
  project: MidiProject | null,
  width: number,
  height: number,
  tickWindow?: TickWindow,
  pitchWindow?: PitchWindow,
): PianoRollViewport {
  if (!project || project.notes.length === 0) {
    return {
      width,
      height,
      startTick: tickWindow?.startTick ?? 0,
      endTick: tickWindow?.endTick ?? Math.max(1, project?.durationTicks ?? 1920),
      lowestPitch: pitchWindow?.lowestPitch ?? 48,
      highestPitch: pitchWindow?.highestPitch ?? 72,
    };
  }

  const pitches = project.notes.map((note) => note.pitch);
  const lowestPitch = pitchWindow?.lowestPitch ?? Math.max(0, Math.min(...pitches) - 2);
  const highestPitch = pitchWindow?.highestPitch ?? Math.min(127, Math.max(...pitches) + 2);

  return {
    width,
    height,
    startTick: tickWindow?.startTick ?? 0,
    endTick: tickWindow?.endTick ?? Math.max(1, project.durationTicks),
    lowestPitch,
    highestPitch,
  };
}

/**
 * Computes a project's full pitch span (lowest/highest note pitch, padded
 * by 2 semitones) — the same bounds `buildViewport` falls back to when no
 * `pitchWindow` is given. Exposed so `PianoRoll.tsx` can resolve a
 * `PitchViewportWindow` against the same span `buildViewport` would
 * otherwise compute itself, keeping the two in agreement.
 */
export function computeFullPitchSpan(project: MidiProject | null): PitchWindow {
  if (!project || project.notes.length === 0) {
    return { lowestPitch: 48, highestPitch: 72 };
  }

  const pitches = project.notes.map((note) => note.pitch);
  return {
    lowestPitch: Math.max(0, Math.min(...pitches) - 2),
    highestPitch: Math.min(127, Math.max(...pitches) + 2),
  };
}

export interface MarqueeRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface NoteRenderStyle {
  fillColor: string;
  strokeColor: string;
  isSelected: boolean;
  isDimmed: boolean;
  isLowConfidence: boolean;
  isChanged: boolean;
  /**
   * Whether the changed-note edge cue should actually render. `isChanged`
   * is a plain fact (is this note id in `changedNoteIds`); this is the
   * fact after precedence — selection suppresses it, since the selection
   * stroke already owns the note's border.
   */
  showChangedEdge: boolean;
  /**
   * Whether the low-confidence dashed outline should actually render.
   * Selection and the changed-note edge cue both suppress it — all three
   * (selection stroke, changed edge, confidence dash) would otherwise
   * compete for the same border, so only the highest-precedence one wins.
   */
  showLowConfidenceDash: boolean;
  /** The previous voice's fill color, for the changed-note edge cue. `null` when the note has no known previous voice (e.g. it didn't exist on the compared side) even though `showChangedEdge` is true. */
  changeEdgeColor: string | null;
  /**
   * Whether the same-voice-overlap underline renders. An independent
   * channel (the note's bottom edge), never suppressed by the border
   * cues — a conflict is severe enough to always show.
   */
  showConflictUnderline: boolean;
}

export interface NoteRenderContext {
  selectedNoteIds: ReadonlySet<string>;
  soloVoiceId: string | null;
  paintPreview: ReadonlyMap<string, string>;
  /** Note ids the active diff comparison reports as reassigned (Slice 4's `AssignmentDiff.changedNoteIds`). */
  changedNoteIds: ReadonlySet<string>;
  /** noteId -> voiceId on the diff's compared ("before") side, for the changed-note edge cue's color. */
  previousVoiceId: ReadonlyMap<string, string>;
  /** When true, fill/stroke show `assignmentConfidence` heat instead of voice color. */
  confidenceHeatmap?: boolean;
  /** Note ids involved in a same-voice overlap (`voiceConflicts.ts`). */
  conflictNoteIds?: ReadonlySet<string>;
}

/**
 * Pure per-note render decision, extracted from the draw loop so the
 * selection/solo/paint-preview/confidence/changed-note logic is
 * unit-testable without a canvas. `drawPianoRoll` just issues the canvas
 * calls this describes.
 *
 * Cue precedence, where cues would otherwise compete for the same visual
 * channel (the note's own border): selection > changed-note edge >
 * low-confidence dash. Paint-preview (the fill/stroke base color) and solo
 * dimming (opacity) are independent channels, never suppressed by this
 * ordering — a note can be paint-previewed and dimmed and show the
 * changed-edge cue all at once.
 */
export function resolveNoteRenderStyle(
  note: MidiNote,
  {
    selectedNoteIds,
    soloVoiceId,
    paintPreview,
    changedNoteIds,
    previousVoiceId,
    confidenceHeatmap = false,
    conflictNoteIds = new Set(),
  }: NoteRenderContext,
): NoteRenderStyle {
  const effectiveVoiceId = paintPreview.get(note.id) ?? note.voiceId;
  const isSelected = selectedNoteIds.has(note.id);
  const isDimmed = soloVoiceId !== null && effectiveVoiceId !== soloVoiceId;
  const isLowConfidence = note.assignmentConfidence < LOW_CONFIDENCE_THRESHOLD;
  const isChanged = changedNoteIds.has(note.id);

  const showChangedEdge = isChanged && !isSelected;
  const showLowConfidenceDash = isLowConfidence && !isSelected && !showChangedEdge;

  const previousVoice = previousVoiceId.get(note.id);
  const changeEdgeColor =
    showChangedEdge && previousVoice ? getVoiceFillColor(previousVoice) : null;

  // In heat view a note's color answers "how sure was the assignment?"
  // instead of "which voice?". An in-progress paint stroke still previews
  // in the target voice's color — live stroke feedback beats the heatmap.
  const useHeat = confidenceHeatmap && !paintPreview.has(note.id);

  return {
    fillColor: useHeat
      ? confidenceHeatColor(note.assignmentConfidence)
      : getVoiceFillColor(effectiveVoiceId),
    strokeColor: isSelected
      ? "#f8fafc"
      : useHeat
        ? confidenceHeatStrokeColor(note.assignmentConfidence)
        : getVoiceStrokeColor(effectiveVoiceId),
    isSelected,
    isDimmed,
    isLowConfidence,
    isChanged,
    showChangedEdge,
    showLowConfidenceDash,
    changeEdgeColor,
    showConflictUnderline: conflictNoteIds.has(note.id),
  };
}

export function drawPianoRoll(
  context: CanvasRenderingContext2D,
  project: MidiProject | null,
  viewport: PianoRollViewport,
  selectedNoteIds: ReadonlySet<string> = new Set(),
  marqueeRect: MarqueeRect | null = null,
  soloVoiceId: string | null = null,
  paintPreview: ReadonlyMap<string, string> = new Map(),
  pitchMarkers: readonly PitchMarker[] = [],
  playheadTick: number | null = null,
  changedNoteIds: ReadonlySet<string> = new Set(),
  previousVoiceId: ReadonlyMap<string, string> = new Map(),
  onlyChangedNotes: boolean = false,
  confidenceHeatmap: boolean = false,
  conflictNoteIds: ReadonlySet<string> = new Set(),
  timeRangeSelection: TickWindow | null = null,
): void {
  context.clearRect(0, 0, viewport.width, viewport.height);
  context.fillStyle = "#111827";
  context.fillRect(0, 0, viewport.width, viewport.height);

  const rollViewport = {
    ...viewport,
    width: Math.max(1, viewport.width - PIANO_ROLL_LABEL_WIDTH),
  };
  const pitchCount = rollViewport.highestPitch - rollViewport.lowestPitch + 1;
  const rowHeight = viewport.height / Math.max(1, pitchCount);

  for (let pitch = rollViewport.lowestPitch; pitch <= rollViewport.highestPitch; pitch += 1) {
    const y = pitchToY(pitch, rollViewport);
    const pitchClass = pitch % 12;
    const isBlackKey = [1, 3, 6, 8, 10].includes(pitchClass);
    context.fillStyle = isBlackKey ? "#172033" : "#111827";
    context.fillRect(PIANO_ROLL_LABEL_WIDTH, y, rollViewport.width, rowHeight + 1);

    if (pitchClass === 0) {
      context.strokeStyle = "#334155";
      context.beginPath();
      context.moveTo(PIANO_ROLL_LABEL_WIDTH, y);
      context.lineTo(viewport.width, y);
      context.stroke();
      context.fillStyle = "#cbd5e1";
      context.font = "12px system-ui";
      context.fillText(`C${Math.floor(pitch / 12) - 1}`, 8, y + 14);
    }
  }

  const beatTicks = Math.max(1, project?.ppq ?? 480);
  // Start at the nearest beat at-or-before the visible window, not
  // unconditionally at tick 0 — once the window can be a zoomed-in
  // sub-range of a long project, looping from the very start every frame
  // would scan far more beats than are ever drawn.
  const firstBeatTick = Math.floor(rollViewport.startTick / beatTicks) * beatTicks;
  for (let tick = firstBeatTick; tick <= rollViewport.endTick; tick += beatTicks) {
    const x = PIANO_ROLL_LABEL_WIDTH + tickToX(tick, rollViewport);
    context.strokeStyle = tick % (beatTicks * 4) === 0 ? "#475569" : "#263244";
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, viewport.height);
    context.stroke();
  }

  context.fillStyle = "#0f172a";
  context.fillRect(0, 0, PIANO_ROLL_LABEL_WIDTH, viewport.height);
  context.strokeStyle = "#475569";
  context.beginPath();
  context.moveTo(PIANO_ROLL_LABEL_WIDTH, 0);
  context.lineTo(PIANO_ROLL_LABEL_WIDTH, viewport.height);
  context.stroke();

  if (timeRangeSelection) {
    const left = PIANO_ROLL_LABEL_WIDTH + tickToX(timeRangeSelection.startTick, rollViewport);
    const right = PIANO_ROLL_LABEL_WIDTH + tickToX(timeRangeSelection.endTick, rollViewport);
    context.fillStyle = "rgba(56, 189, 248, 0.18)";
    context.fillRect(Math.min(left, right), 0, Math.abs(right - left), viewport.height);
  }

  if (!project || project.notes.length === 0) {
    context.fillStyle = "#94a3b8";
    context.font = "14px system-ui";
    context.fillText("No notes loaded", PIANO_ROLL_LABEL_WIDTH + 24, 40);
    return;
  }

  const sortedNotes = [...project.notes]
    .filter((note) => !onlyChangedNotes || changedNoteIds.has(note.id))
    .sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
  for (const note of sortedNotes) {
    const x = PIANO_ROLL_LABEL_WIDTH + tickToX(note.startTick, rollViewport);
    const y = pitchToY(note.pitch, rollViewport);
    const endX = PIANO_ROLL_LABEL_WIDTH + tickToX(note.endTick, rollViewport);
    const width = Math.max(2, endX - x);
    const height = Math.max(2, rowHeight - 2);

    const style = resolveNoteRenderStyle(note, {
      selectedNoteIds,
      soloVoiceId,
      paintPreview,
      changedNoteIds,
      previousVoiceId,
      confidenceHeatmap,
      conflictNoteIds,
    });
    context.globalAlpha = style.isDimmed ? 0.25 : 1;
    context.fillStyle = style.fillColor;
    context.fillRect(x, y + 1, width, height);
    context.strokeStyle = style.strokeColor;
    context.lineWidth = style.isSelected ? 3 : 1;
    if (style.showLowConfidenceDash) {
      context.setLineDash([3, 2]);
    }
    context.strokeRect(x, y + 1, width, height);
    context.setLineDash([]);
    context.lineWidth = 1;

    if (style.showChangedEdge) {
      context.fillStyle = style.changeEdgeColor ?? DEFAULT_CHANGE_EDGE_COLOR;
      context.fillRect(x, y + 1, Math.min(CHANGE_EDGE_WIDTH_PX, width), height);
    }

    if (style.showConflictUnderline) {
      context.fillStyle = CONFLICT_UNDERLINE_COLOR;
      context.fillRect(
        x,
        y + 1 + Math.max(0, height - CONFLICT_UNDERLINE_HEIGHT_PX),
        width,
        CONFLICT_UNDERLINE_HEIGHT_PX,
      );
    }

    context.globalAlpha = 1;
  }

  drawPitchMarkers(context, viewport, pitchMarkers);
  drawPlayhead(context, rollViewport, viewport.height, playheadTick);

  if (marqueeRect) {
    const left = Math.min(marqueeRect.x0, marqueeRect.x1);
    const top = Math.min(marqueeRect.y0, marqueeRect.y1);
    const width = Math.abs(marqueeRect.x1 - marqueeRect.x0);
    const height = Math.abs(marqueeRect.y1 - marqueeRect.y0);

    context.fillStyle = "rgba(56, 189, 248, 0.15)";
    context.fillRect(left, top, width, height);
    context.strokeStyle = "#38bdf8";
    context.lineWidth = 1;
    context.setLineDash([4, 3]);
    context.strokeRect(left, top, width, height);
    context.setLineDash([]);
  }
}

export function drawTimeRuler(
  context: CanvasRenderingContext2D,
  viewport: PianoRollViewport,
  ppq: number,
  playheadTick: number | null = null,
  timeRangeSelection: TickWindow | null = null,
): void {
  context.clearRect(0, 0, viewport.width, TIME_RULER_HEIGHT);
  context.fillStyle = "#0f172a";
  context.fillRect(0, 0, viewport.width, TIME_RULER_HEIGHT);

  const rollViewport = {
    ...viewport,
    width: Math.max(1, viewport.width - PIANO_ROLL_LABEL_WIDTH),
  };

  context.fillStyle = "#111827";
  context.fillRect(PIANO_ROLL_LABEL_WIDTH, 0, rollViewport.width, TIME_RULER_HEIGHT);

  if (timeRangeSelection) {
    const left = PIANO_ROLL_LABEL_WIDTH + tickToX(timeRangeSelection.startTick, rollViewport);
    const right = PIANO_ROLL_LABEL_WIDTH + tickToX(timeRangeSelection.endTick, rollViewport);
    context.fillStyle = "rgba(56, 189, 248, 0.28)";
    context.fillRect(Math.min(left, right), 0, Math.abs(right - left), TIME_RULER_HEIGHT);
  }

  const beatTicks = Math.max(1, ppq);
  const firstBeatTick = Math.floor(rollViewport.startTick / beatTicks) * beatTicks;
  context.font = "11px system-ui";
  context.textBaseline = "top";
  for (let tick = firstBeatTick; tick <= rollViewport.endTick; tick += beatTicks) {
    const x = PIANO_ROLL_LABEL_WIDTH + tickToX(tick, rollViewport);
    const isBar = tick % (beatTicks * 4) === 0;
    context.strokeStyle = isBar ? "#64748b" : "#334155";
    context.beginPath();
    context.moveTo(x, isBar ? 2 : 8);
    context.lineTo(x, TIME_RULER_HEIGHT);
    context.stroke();
    if (isBar) {
      context.fillStyle = "#cbd5e1";
      context.fillText(String(Math.floor(tick / (beatTicks * 4)) + 1), x + 4, 3);
    }
  }

  context.strokeStyle = "#475569";
  context.beginPath();
  context.moveTo(PIANO_ROLL_LABEL_WIDTH, 0);
  context.lineTo(PIANO_ROLL_LABEL_WIDTH, TIME_RULER_HEIGHT);
  context.moveTo(0, TIME_RULER_HEIGHT - 0.5);
  context.lineTo(viewport.width, TIME_RULER_HEIGHT - 0.5);
  context.stroke();

  if (
    playheadTick !== null &&
    playheadTick >= rollViewport.startTick &&
    playheadTick <= rollViewport.endTick
  ) {
    const x = PIANO_ROLL_LABEL_WIDTH + tickToX(playheadTick, rollViewport);
    context.strokeStyle = "#f8fafc";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, TIME_RULER_HEIGHT);
    context.stroke();
    context.lineWidth = 1;
  }
}
export function drawVoiceLanes(
  context: CanvasRenderingContext2D,
  project: MidiProject | null,
  viewport: PianoRollViewport,
  selectedNoteIds: ReadonlySet<string> = new Set(),
  soloVoiceId: string | null = null,
  paintPreview: ReadonlyMap<string, string> = new Map(),
  playheadTick: number | null = null,
  changedNoteIds: ReadonlySet<string> = new Set(),
  previousVoiceId: ReadonlyMap<string, string> = new Map(),
  onlyChangedNotes: boolean = false,
  confidenceHeatmap: boolean = false,
): void {
  context.clearRect(0, 0, viewport.width, viewport.height);
  context.fillStyle = "#111827";
  context.fillRect(0, 0, viewport.width, viewport.height);

  if (!project || project.notes.length === 0) {
    context.fillStyle = "#94a3b8";
    context.font = "14px system-ui";
    context.fillText("No notes loaded", VOICE_LANE_LABEL_WIDTH + 24, 40);
    return;
  }

  const lanes = buildVoiceLaneLayout(project.voices, viewport.height);
  const rollViewport = {
    ...viewport,
    width: Math.max(1, viewport.width - VOICE_LANE_LABEL_WIDTH),
  };

  context.fillStyle = "#0f172a";
  context.fillRect(0, 0, VOICE_LANE_LABEL_WIDTH, viewport.height);
  context.strokeStyle = "#475569";
  context.beginPath();
  context.moveTo(VOICE_LANE_LABEL_WIDTH, 0);
  context.lineTo(VOICE_LANE_LABEL_WIDTH, viewport.height);
  context.stroke();

  for (const lane of lanes) {
    context.fillStyle = (lane.y / Math.max(1, lane.height)) % 2 === 0 ? "#111827" : "#0f172a";
    context.fillRect(VOICE_LANE_LABEL_WIDTH, lane.y, rollViewport.width, lane.height);
    context.strokeStyle = "#263244";
    context.beginPath();
    context.moveTo(0, lane.y);
    context.lineTo(viewport.width, lane.y);
    context.stroke();
    context.fillStyle = "#cbd5e1";
    context.font = "12px system-ui";
    context.fillText(lane.label, 8, lane.y + Math.min(18, lane.height - 8));
  }

  const beatTicks = Math.max(1, project.ppq);
  const firstBeatTick = Math.floor(rollViewport.startTick / beatTicks) * beatTicks;
  for (let tick = firstBeatTick; tick <= rollViewport.endTick; tick += beatTicks) {
    const x = VOICE_LANE_LABEL_WIDTH + tickToX(tick, rollViewport);
    context.strokeStyle = tick % (beatTicks * 4) === 0 ? "#475569" : "#263244";
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, viewport.height);
    context.stroke();
  }

  const sortedNotes = [...project.notes]
    .filter((note) => !onlyChangedNotes || changedNoteIds.has(note.id))
    .sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
  for (const note of sortedNotes) {
    const lane = findVoiceLane(lanes, note.voiceId);
    if (!lane) {
      continue;
    }
    const rect = voiceLaneNoteRect(note, lane, viewport);
    const style = resolveNoteRenderStyle(note, {
      selectedNoteIds,
      soloVoiceId,
      paintPreview,
      changedNoteIds,
      previousVoiceId,
      confidenceHeatmap,
    });

    context.globalAlpha = style.isDimmed ? 0.25 : 1;
    context.fillStyle = style.fillColor;
    context.fillRect(rect.x, rect.y, rect.width, rect.height);
    context.strokeStyle = style.strokeColor;
    context.lineWidth = style.isSelected ? 3 : 1;
    if (style.showLowConfidenceDash) {
      context.setLineDash([3, 2]);
    }
    context.strokeRect(rect.x, rect.y, rect.width, rect.height);
    context.setLineDash([]);
    context.lineWidth = 1;

    if (style.showChangedEdge) {
      context.fillStyle = style.changeEdgeColor ?? DEFAULT_CHANGE_EDGE_COLOR;
      context.fillRect(rect.x, rect.y, Math.min(CHANGE_EDGE_WIDTH_PX, rect.width), rect.height);
    }

    context.globalAlpha = 1;
  }

  drawLanePlayhead(context, rollViewport, viewport.height, playheadTick);
}

function drawLanePlayhead(
  context: CanvasRenderingContext2D,
  rollViewport: PianoRollViewport,
  height: number,
  playheadTick: number | null,
): void {
  if (
    playheadTick === null ||
    playheadTick < rollViewport.startTick ||
    playheadTick > rollViewport.endTick
  ) {
    return;
  }

  const x = VOICE_LANE_LABEL_WIDTH + tickToX(playheadTick, rollViewport);
  context.globalAlpha = 1;
  context.strokeStyle = "#f8fafc";
  context.lineWidth = 2;
  context.setLineDash([]);
  context.beginPath();
  context.moveTo(x, 0);
  context.lineTo(x, height);
  context.stroke();
  context.lineWidth = 1;
}
function drawPlayhead(
  context: CanvasRenderingContext2D,
  rollViewport: PianoRollViewport,
  height: number,
  playheadTick: number | null,
): void {
  if (
    playheadTick === null ||
    playheadTick < rollViewport.startTick ||
    playheadTick > rollViewport.endTick
  ) {
    return;
  }

  const x = PIANO_ROLL_LABEL_WIDTH + tickToX(playheadTick, rollViewport);
  context.globalAlpha = 1;
  context.strokeStyle = "#f8fafc";
  context.lineWidth = 2;
  context.setLineDash([]);
  context.beginPath();
  context.moveTo(x, 0);
  context.lineTo(x, height);
  context.stroke();
  context.lineWidth = 1;
}

function drawPitchMarkers(
  context: CanvasRenderingContext2D,
  viewport: PianoRollViewport,
  pitchMarkers: readonly PitchMarker[],
): void {
  if (pitchMarkers.length === 0) {
    return;
  }

  for (const marker of pitchMarkers) {
    if (marker.pitch < viewport.lowestPitch || marker.pitch > viewport.highestPitch) {
      continue;
    }

    const y = pitchToY(marker.pitch, viewport);
    context.globalAlpha = 1;
    context.strokeStyle = "#f97316";
    context.lineWidth = 1;
    context.setLineDash([6, 4]);
    context.beginPath();
    context.moveTo(PIANO_ROLL_LABEL_WIDTH, y);
    context.lineTo(viewport.width, y);
    context.stroke();
    context.setLineDash([]);

    context.fillStyle = "#f97316";
    context.beginPath();
    context.moveTo(PIANO_ROLL_LABEL_WIDTH - 8, y);
    context.lineTo(PIANO_ROLL_LABEL_WIDTH - 1, y - 5);
    context.lineTo(PIANO_ROLL_LABEL_WIDTH - 1, y + 5);
    context.closePath();
    context.fill();

    context.fillStyle = "#fed7aa";
    context.font = "11px system-ui";
    context.fillText(`${marker.label}: ${marker.pitch}`, 6, Math.max(12, y - 7));
  }
}
