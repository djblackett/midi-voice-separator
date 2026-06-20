import type { TempoChange } from "./midiProject";

const DEFAULT_MICROSECONDS_PER_QUARTER = 500_000; // 120 BPM

interface TempoSegment {
  startTick: number;
  startSeconds: number;
  secondsPerTick: number;
}

export interface TempoMap {
  segments: TempoSegment[];
}

function secondsPerTickFor(microsecondsPerQuarter: number, ppq: number): number {
  return microsecondsPerQuarter / 1_000_000 / Math.max(1, ppq);
}

/**
 * Precomputes a piecewise-linear tick/seconds mapping from a project's
 * tempo-change list. Defaults to 120 BPM if there is no tempo change at
 * (or before) tick 0, matching how most Standard MIDI Files behave when a
 * tempo meta-event is absent.
 */
export function buildTempoMap(tempoChanges: readonly TempoChange[], ppq: number): TempoMap {
  const sorted = [...tempoChanges].sort((left, right) => left.tick - right.tick);
  const segments: TempoSegment[] = [];

  if (sorted.length === 0 || sorted[0].tick > 0) {
    segments.push({
      startTick: 0,
      startSeconds: 0,
      secondsPerTick: secondsPerTickFor(DEFAULT_MICROSECONDS_PER_QUARTER, ppq),
    });
  }

  for (const tempoChange of sorted) {
    const previous = segments[segments.length - 1];
    const startSeconds = previous
      ? previous.startSeconds + (tempoChange.tick - previous.startTick) * previous.secondsPerTick
      : 0;
    segments.push({
      startTick: tempoChange.tick,
      startSeconds,
      secondsPerTick: secondsPerTickFor(tempoChange.microsecondsPerQuarter, ppq),
    });
  }

  return { segments };
}

function segmentForTick(tempoMap: TempoMap, tick: number): TempoSegment {
  let result = tempoMap.segments[0];
  for (const segment of tempoMap.segments) {
    if (segment.startTick > tick) {
      break;
    }
    result = segment;
  }
  return result;
}

function segmentForSeconds(tempoMap: TempoMap, seconds: number): TempoSegment {
  let result = tempoMap.segments[0];
  for (const segment of tempoMap.segments) {
    if (segment.startSeconds > seconds) {
      break;
    }
    result = segment;
  }
  return result;
}

export function tickToSeconds(tempoMap: TempoMap, tick: number): number {
  const segment = segmentForTick(tempoMap, tick);
  return segment.startSeconds + (tick - segment.startTick) * segment.secondsPerTick;
}

export function secondsToTick(tempoMap: TempoMap, seconds: number): number {
  const segment = segmentForSeconds(tempoMap, seconds);
  if (segment.secondsPerTick <= 0) {
    return segment.startTick;
  }
  return segment.startTick + (seconds - segment.startSeconds) / segment.secondsPerTick;
}
