import type { PianoRollViewport } from "../../domain/midi/viewport";

function tickSpan(viewport: PianoRollViewport): number {
  return Math.max(1, viewport.endTick - viewport.startTick);
}

function pitchSpan(viewport: PianoRollViewport): number {
  return Math.max(1, viewport.highestPitch - viewport.lowestPitch + 1);
}

export function tickToX(tick: number, viewport: PianoRollViewport): number {
  return ((tick - viewport.startTick) / tickSpan(viewport)) * viewport.width;
}

export function xToTick(x: number, viewport: PianoRollViewport): number {
  return viewport.startTick + (x / Math.max(1, viewport.width)) * tickSpan(viewport);
}

export function pitchToY(pitch: number, viewport: PianoRollViewport): number {
  return ((viewport.highestPitch - pitch) / pitchSpan(viewport)) * viewport.height;
}

export function yToPitch(y: number, viewport: PianoRollViewport): number {
  const pitch = viewport.highestPitch - (y / Math.max(1, viewport.height)) * pitchSpan(viewport);
  return Math.floor(pitch);
}
