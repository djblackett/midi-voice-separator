import {
  LOW_CONFIDENCE_THRESHOLD,
  type MidiNote,
  type MidiProject,
} from "../../domain/midi/midiProject";
import type { PitchMarker } from "../../domain/midi/rangeRules";
import type { PianoRollViewport } from "../../domain/midi/viewport";
import { pitchToY, tickToX } from "./coordinates";

export const PIANO_ROLL_LABEL_WIDTH = 56;
const VOICE_COLORS = ["#38bdf8", "#a78bfa", "#34d399", "#fbbf24", "#fb7185", "#f472b6"];
const VOICE_STROKES = ["#7dd3fc", "#c4b5fd", "#86efac", "#fde68a", "#fda4af", "#f9a8d4"];

function voiceColorIndex(voiceId: string): number {
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

export interface TickWindow {
  startTick: number;
  endTick: number;
}

export function buildViewport(
  project: MidiProject | null,
  width: number,
  height: number,
  tickWindow?: TickWindow,
): PianoRollViewport {
  if (!project || project.notes.length === 0) {
    return {
      width,
      height,
      startTick: tickWindow?.startTick ?? 0,
      endTick: tickWindow?.endTick ?? Math.max(1, project?.durationTicks ?? 1920),
      lowestPitch: 48,
      highestPitch: 72,
    };
  }

  const pitches = project.notes.map((note) => note.pitch);
  const lowestPitch = Math.max(0, Math.min(...pitches) - 2);
  const highestPitch = Math.min(127, Math.max(...pitches) + 2);

  return {
    width,
    height,
    startTick: tickWindow?.startTick ?? 0,
    endTick: tickWindow?.endTick ?? Math.max(1, project.durationTicks),
    lowestPitch,
    highestPitch,
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
}

export interface NoteRenderContext {
  selectedNoteIds: ReadonlySet<string>;
  soloVoiceId: string | null;
  paintPreview: ReadonlyMap<string, string>;
}

/**
 * Pure per-note render decision, extracted from the draw loop so the
 * selection/solo/paint-preview/confidence logic is unit-testable without a
 * canvas. `drawPianoRoll` just issues the canvas calls this describes.
 */
export function resolveNoteRenderStyle(
  note: MidiNote,
  { selectedNoteIds, soloVoiceId, paintPreview }: NoteRenderContext,
): NoteRenderStyle {
  const effectiveVoiceId = paintPreview.get(note.id) ?? note.voiceId;
  const isSelected = selectedNoteIds.has(note.id);
  const isDimmed = soloVoiceId !== null && effectiveVoiceId !== soloVoiceId;
  const isLowConfidence = note.assignmentConfidence < LOW_CONFIDENCE_THRESHOLD;

  return {
    fillColor: getVoiceFillColor(effectiveVoiceId),
    strokeColor: isSelected ? "#f8fafc" : getVoiceStrokeColor(effectiveVoiceId),
    isSelected,
    isDimmed,
    isLowConfidence,
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

  if (!project || project.notes.length === 0) {
    context.fillStyle = "#94a3b8";
    context.font = "14px system-ui";
    context.fillText("No notes loaded", PIANO_ROLL_LABEL_WIDTH + 24, 40);
    return;
  }

  const sortedNotes = [...project.notes].sort(
    (a, b) => a.startTick - b.startTick || a.pitch - b.pitch,
  );
  for (const note of sortedNotes) {
    const x = PIANO_ROLL_LABEL_WIDTH + tickToX(note.startTick, rollViewport);
    const y = pitchToY(note.pitch, rollViewport);
    const endX = PIANO_ROLL_LABEL_WIDTH + tickToX(note.endTick, rollViewport);
    const width = Math.max(2, endX - x);
    const height = Math.max(2, rowHeight - 2);

    const style = resolveNoteRenderStyle(note, { selectedNoteIds, soloVoiceId, paintPreview });
    context.globalAlpha = style.isDimmed ? 0.25 : 1;
    context.fillStyle = style.fillColor;
    context.fillRect(x, y + 1, width, height);
    context.strokeStyle = style.strokeColor;
    context.lineWidth = style.isSelected ? 3 : 1;
    if (style.isLowConfidence && !style.isSelected) {
      context.setLineDash([3, 2]);
    }
    context.strokeRect(x, y + 1, width, height);
    context.setLineDash([]);
    context.lineWidth = 1;
    context.globalAlpha = 1;
  }

  drawPitchMarkers(context, viewport, pitchMarkers);

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
