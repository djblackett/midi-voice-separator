import type { MidiProject } from "../../domain/midi/midiProject";
import type { PianoRollViewport } from "../../domain/midi/viewport";
import { pitchToY, tickToX } from "./coordinates";

const LABEL_WIDTH = 56;

export function buildViewport(
  project: MidiProject | null,
  width: number,
  height: number,
): PianoRollViewport {
  if (!project || project.notes.length === 0) {
    return {
      width,
      height,
      startTick: 0,
      endTick: Math.max(1, project?.durationTicks ?? 1920),
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
    startTick: 0,
    endTick: Math.max(1, project.durationTicks),
    lowestPitch,
    highestPitch,
  };
}

export function drawPianoRoll(
  context: CanvasRenderingContext2D,
  project: MidiProject | null,
  viewport: PianoRollViewport,
): void {
  context.clearRect(0, 0, viewport.width, viewport.height);
  context.fillStyle = "#111827";
  context.fillRect(0, 0, viewport.width, viewport.height);

  const rollViewport = { ...viewport, width: Math.max(1, viewport.width - LABEL_WIDTH) };
  const pitchCount = rollViewport.highestPitch - rollViewport.lowestPitch + 1;
  const rowHeight = viewport.height / Math.max(1, pitchCount);

  for (let pitch = rollViewport.lowestPitch; pitch <= rollViewport.highestPitch; pitch += 1) {
    const y = pitchToY(pitch, rollViewport);
    const pitchClass = pitch % 12;
    const isBlackKey = [1, 3, 6, 8, 10].includes(pitchClass);
    context.fillStyle = isBlackKey ? "#172033" : "#111827";
    context.fillRect(LABEL_WIDTH, y, rollViewport.width, rowHeight + 1);

    if (pitchClass === 0) {
      context.strokeStyle = "#334155";
      context.beginPath();
      context.moveTo(LABEL_WIDTH, y);
      context.lineTo(viewport.width, y);
      context.stroke();
      context.fillStyle = "#cbd5e1";
      context.font = "12px system-ui";
      context.fillText(`C${Math.floor(pitch / 12) - 1}`, 8, y + 14);
    }
  }

  const beatTicks = Math.max(1, project?.ppq ?? 480);
  for (let tick = 0; tick <= rollViewport.endTick; tick += beatTicks) {
    const x = LABEL_WIDTH + tickToX(tick, rollViewport);
    context.strokeStyle = tick % (beatTicks * 4) === 0 ? "#475569" : "#263244";
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, viewport.height);
    context.stroke();
  }

  context.fillStyle = "#0f172a";
  context.fillRect(0, 0, LABEL_WIDTH, viewport.height);
  context.strokeStyle = "#475569";
  context.beginPath();
  context.moveTo(LABEL_WIDTH, 0);
  context.lineTo(LABEL_WIDTH, viewport.height);
  context.stroke();

  if (!project || project.notes.length === 0) {
    context.fillStyle = "#94a3b8";
    context.font = "14px system-ui";
    context.fillText("No notes loaded", LABEL_WIDTH + 24, 40);
    return;
  }

  const sortedNotes = [...project.notes].sort(
    (a, b) => a.startTick - b.startTick || a.pitch - b.pitch,
  );
  for (const note of sortedNotes) {
    const x = LABEL_WIDTH + tickToX(note.startTick, rollViewport);
    const y = pitchToY(note.pitch, rollViewport);
    const endX = LABEL_WIDTH + tickToX(note.endTick, rollViewport);
    const width = Math.max(2, endX - x);
    const height = Math.max(2, rowHeight - 2);

    context.fillStyle = "#38bdf8";
    context.fillRect(x, y + 1, width, height);
    context.strokeStyle = "#7dd3fc";
    context.strokeRect(x, y + 1, width, height);
  }
}
