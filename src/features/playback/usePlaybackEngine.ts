import { useEffect, useRef, useState } from "react";
import type { MidiProject } from "../../domain/midi/midiProject";
import {
  buildTempoMap,
  secondsToTick,
  tickToSeconds,
  type TempoMap,
} from "../../domain/midi/tempoMap";
import { PlaybackEngine } from "./playbackEngine";
import { buildScheduledNotes } from "./scheduledNotes";

const PLAYHEAD_UPDATE_INTERVAL_MS = 50; // ~20fps, enough to look smooth without flooding re-renders

export interface PlaybackControls {
  isPlaying: boolean;
  currentTick: number;
  play: () => void;
  pause: () => void;
  stop: () => void;
  seek: (tick: number) => void;
}

export function usePlaybackEngine(
  project: MidiProject | null,
  soloVoiceId: string | null,
): PlaybackControls {
  const engineRef = useRef<PlaybackEngine | null>(null);
  const tempoMapRef = useRef<TempoMap | null>(null);
  const playStartedAtTickRef = useRef(0);
  const playStartedAtAudioTimeRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTick, setCurrentTick] = useState(0);

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

  function startFrom(tick: number) {
    if (!project) {
      return;
    }

    const tempoMap = buildTempoMap(project.tempoChanges, project.ppq);
    tempoMapRef.current = tempoMap;
    const engine = getEngine();
    engine.stop();

    const scheduledNotes = buildScheduledNotes(project.notes, tempoMap, tick, soloVoiceId);
    engine.play(scheduledNotes);

    playStartedAtTickRef.current = tick;
    playStartedAtAudioTimeRef.current = engine.getCurrentTime();
    setCurrentTick(tick);
    setIsPlaying(true);

    const durationSeconds = tickToSeconds(tempoMap, project.durationTicks);
    stopTickPolling();
    intervalRef.current = setInterval(() => {
      const elapsed = engine.getCurrentTime() - playStartedAtAudioTimeRef.current;
      const startSeconds = tickToSeconds(tempoMap, playStartedAtTickRef.current);
      const nowTick = secondsToTick(tempoMap, startSeconds + elapsed);

      if (startSeconds + elapsed >= durationSeconds) {
        engine.stop();
        stopTickPolling();
        setIsPlaying(false);
        setCurrentTick(project.durationTicks);
        return;
      }

      setCurrentTick(nowTick);
    }, PLAYHEAD_UPDATE_INTERVAL_MS);
  }

  function play() {
    startFrom(currentTick >= (project?.durationTicks ?? 0) ? 0 : currentTick);
  }

  function pause() {
    getEngine().stop();
    stopTickPolling();
    setIsPlaying(false);
  }

  function stop() {
    getEngine().stop();
    stopTickPolling();
    setIsPlaying(false);
    setCurrentTick(0);
  }

  function seek(tick: number) {
    const clamped = Math.max(0, Math.min(project?.durationTicks ?? 0, tick));
    if (isPlaying) {
      startFrom(clamped);
    } else {
      setCurrentTick(clamped);
    }
  }

  // Reset to a stopped state whenever a new project is loaded.
  useEffect(() => {
    getEngine().stop();
    stopTickPolling();
    setIsPlaying(false);
    setCurrentTick(0);
  }, [project?.fileName, project?.durationTicks]);

  // Tear down the audio context and polling on unmount.
  useEffect(() => {
    return () => {
      stopTickPolling();
      engineRef.current?.dispose();
    };
  }, []);

  return { isPlaying, currentTick, play, pause, stop, seek };
}
