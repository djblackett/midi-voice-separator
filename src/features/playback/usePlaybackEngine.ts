import { useEffect, useRef, useState } from "react";
import type { MidiNote, MidiProject } from "../../domain/midi/midiProject";
import {
  buildTempoMap,
  secondsToTick,
  tickToSeconds,
  type TempoMap,
} from "../../domain/midi/tempoMap";
import { PlaybackEngine, type Instrument } from "./playbackEngine";
import {
  buildAuditionNotes,
  buildScheduledNotes,
  filterNotesForPlaybackScope,
  type PlaybackScope,
} from "./scheduledNotes";

const PLAYHEAD_UPDATE_INTERVAL_MS = 50; // ~20fps, enough to look smooth without flooding re-renders

export interface PlaybackControls {
  isPlaying: boolean;
  currentTick: number;
  play: () => void;
  pause: () => void;
  stop: () => void;
  seek: (tick: number) => void;
  /** Plays short preview blips for `notes` (paint/click audition). */
  audition: (notes: readonly MidiNote[]) => void;
  blockedReason: string | null;
}

/**
 * One transport, one replaceable source (M12). Everything the transport needs
 * travels inside the source, so it never reaches back into per-side state.
 * `sourceId` is the side + branch-revision identity used to decide when to
 * reschedule; `lineageId` is the imported-file identity used to decide when to
 * reset (a genuinely new piece), so switching between same-lineage sides never
 * resets the playhead.
 */
export interface PlaybackSource {
  readonly sourceId: string;
  readonly lineageId: string;
  readonly notes: MidiProject["notes"];
  readonly ppq: number;
  readonly tempoChanges: MidiProject["tempoChanges"];
  readonly durationTicks: number;
  readonly soloVoiceId: string | null;
  readonly scope: PlaybackScope;
  readonly presentationKeyByVoiceId: ReadonlyMap<string, string>;
}

export function usePlaybackEngine(
  source: PlaybackSource | null,
  instrument: Instrument = "chiptune",
): PlaybackControls {
  const engineRef = useRef<PlaybackEngine | null>(null);
  const tempoMapRef = useRef<TempoMap | null>(null);
  const playStartedAtTickRef = useRef(0);
  const playStartedAtAudioTimeRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playRequestIdRef = useRef(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTick, setCurrentTick] = useState(0);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);

  function getEngine(): PlaybackEngine {
    if (!engineRef.current) {
      engineRef.current = new PlaybackEngine();
    }
    return engineRef.current;
  }

  function stopTickPolling() {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  async function startFrom(tick: number) {
    if (!source) {
      return;
    }

    const tempoMap = buildTempoMap(source.tempoChanges, source.ppq);
    tempoMapRef.current = tempoMap;
    const engine = getEngine();
    engine.stop();
    stopTickPolling();

    // Piano samples load (once, then cached) before scheduling; a pause/
    // stop/newer-play issued while loading supersedes this request, so a
    // slow first load can't start stale playback after the user moved on.
    const requestId = ++playRequestIdRef.current;
    try {
      await engine.prepare(instrument);
    } catch {
      // Sample loading failed (e.g. offline dev server); the engine falls
      // back to chiptune synthesis rather than playing nothing.
    }
    if (playRequestIdRef.current !== requestId) {
      return;
    }

    const scopeResult = filterNotesForPlaybackScope(
      source.notes,
      tick,
      source.soloVoiceId,
      source.scope,
    );
    if (scopeResult.emptyReason) {
      setBlockedReason(scopeResult.emptyReason);
      setIsPlaying(false);
      return;
    }
    const scheduledNotes = buildScheduledNotes(
      source.notes,
      tempoMap,
      tick,
      source.soloVoiceId,
      source.scope,
      source.presentationKeyByVoiceId,
    );
    setBlockedReason(null);
    engine.play(scheduledNotes, instrument);

    playStartedAtTickRef.current = tick;
    playStartedAtAudioTimeRef.current = engine.getCurrentTime();
    setCurrentTick(tick);
    setIsPlaying(true);

    const durationSeconds = tickToSeconds(tempoMap, source.durationTicks);
    stopTickPolling();
    intervalRef.current = setInterval(() => {
      const elapsed = engine.getCurrentTime() - playStartedAtAudioTimeRef.current;
      const startSeconds = tickToSeconds(tempoMap, playStartedAtTickRef.current);
      const nowTick = secondsToTick(tempoMap, startSeconds + elapsed);

      if (startSeconds + elapsed >= durationSeconds) {
        engine.stop();
        stopTickPolling();
        setIsPlaying(false);
        setCurrentTick(source.durationTicks);
        return;
      }

      setCurrentTick(nowTick);
    }, PLAYHEAD_UPDATE_INTERVAL_MS);
  }

  function play() {
    void startFrom(currentTick >= (source?.durationTicks ?? 0) ? 0 : currentTick);
  }

  function pause() {
    playRequestIdRef.current++;
    getEngine().stop();
    stopTickPolling();
    setIsPlaying(false);
    setBlockedReason(null);
  }

  function stop() {
    playRequestIdRef.current++;
    getEngine().stop();
    stopTickPolling();
    setIsPlaying(false);
    setBlockedReason(null);
    setCurrentTick(0);
  }

  function seek(tick: number) {
    const clamped = Math.max(0, Math.min(source?.durationTicks ?? 0, tick));
    if (isPlaying) {
      void startFrom(clamped);
    } else {
      setCurrentTick(clamped);
    }
  }

  function audition(notes: readonly MidiNote[]) {
    // Blips over running transport playback are just noise — skip. Piano
    // falls back to chiptune synthesis inside the engine if its samples
    // aren't loaded yet, so audition never awaits a sample fetch.
    if (isPlaying || notes.length === 0) {
      return;
    }
    getEngine().play(
      buildAuditionNotes(notes, source?.presentationKeyByVoiceId ?? new Map()),
      instrument,
    );
  }

  useEffect(() => {
    setBlockedReason(null);
  }, [source?.scope, source?.soloVoiceId]);
  // Reset to a stopped state whenever a genuinely new piece is loaded (a new
  // lineage). Switching between same-lineage sides keeps the same timeline, so
  // it must not reset the playhead here.
  useEffect(() => {
    playRequestIdRef.current++;
    getEngine().stop();
    stopTickPolling();
    setIsPlaying(false);
    setBlockedReason(null);
    setCurrentTick(0);
  }, [source?.lineageId, source?.durationTicks]);

  // Warm the sample cache as soon as piano is selected, so the first Play
  // afterwards doesn't stall on a network fetch + decode.
  useEffect(() => {
    if (instrument === "piano") {
      getEngine()
        .prepare("piano")
        .catch(() => {
          // Preloading is best-effort; startFrom handles failure again.
        });
    }
  }, [instrument]);

  // Tear down the audio context and polling on unmount.
  useEffect(() => {
    return () => {
      stopTickPolling();
      engineRef.current?.dispose();
    };
  }, []);

  return { isPlaying, currentTick, play, pause, stop, seek, audition, blockedReason };
}
