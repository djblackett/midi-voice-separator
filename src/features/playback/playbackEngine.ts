import { nearestSamplePitch, PianoSampler } from "./pianoSampler";
import type { ScheduledNote } from "./scheduledNotes";

export type Instrument = "chiptune" | "piano";

const ATTACK_SECONDS = 0.005;
const RELEASE_SECONDS = 0.02;

// Piano-sample notes are mixed hotter than the raw oscillators (a recorded
// piano decays naturally instead of holding at full amplitude), with a
// longer release so cutting a sample off at note-end doesn't click.
const PIANO_GAIN_MULTIPLIER = 2.5;
const PIANO_RELEASE_SECONDS = 0.1;

interface ActiveNode {
  source: AudioScheduledSourceNode;
  gain: GainNode;
}

/**
 * Thin Web Audio wrapper: makes no decisions about what should play
 * (that's `scheduledNotes.ts`'s job), it just creates and tears down real
 * audio nodes. Kept deliberately small and untested at the unit level —
 * real audio I/O is exercised by the manual verification pass, the same
 * category as `PianoRoll.tsx`'s pointer-event glue.
 */
export class PlaybackEngine {
  private audioContext: AudioContext | null = null;
  private activeNodes: ActiveNode[] = [];
  private pianoSampler = new PianoSampler();
  private pianoBus: DynamicsCompressorNode | null = null;

  private getAudioContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }
    return this.audioContext;
  }

  getCurrentTime(): number {
    return this.audioContext?.currentTime ?? 0;
  }

  /**
   * Resolves once `instrument` is ready to play. Chiptune is always ready;
   * piano fetches and decodes the sample set on first call (cached after).
   */
  prepare(instrument: Instrument): Promise<void> {
    if (instrument !== "piano") {
      return Promise.resolve();
    }
    return this.pianoSampler.load(this.getAudioContext());
  }

  // Piano notes share a compressor before the destination: sampled chords
  // stack far more energy than the fixed-gain oscillators, and chaotic
  // passages would clip without it.
  private getPianoBus(context: AudioContext): DynamicsCompressorNode {
    if (!this.pianoBus) {
      this.pianoBus = context.createDynamicsCompressor();
      this.pianoBus.connect(context.destination);
    }
    return this.pianoBus;
  }

  /** Schedules every note in `scheduledNotes`, relative to "now". */
  play(scheduledNotes: readonly ScheduledNote[], instrument: Instrument = "chiptune"): void {
    const context = this.getAudioContext();
    // Chrome's autoplay policy can leave a freshly-created AudioContext
    // suspended even when constructed inside a user-gesture handler (the
    // Play button's click); without an explicit resume(), playback would
    // silently produce no sound rather than erroring.
    if (context.state === "suspended") {
      void context.resume();
    }
    const now = context.currentTime;
    // If the samples somehow aren't loaded (prepare() failed — e.g. a
    // missing file), fall back to chiptune rather than playing silence.
    const usePiano = instrument === "piano" && this.pianoSampler.isLoaded();

    for (const note of scheduledNotes) {
      const startTime = now + note.startSeconds;
      const endTime = Math.max(startTime + ATTACK_SECONDS, now + note.endSeconds);
      const scheduled = usePiano
        ? this.schedulePianoNote(context, note, startTime, endTime)
        : this.scheduleChiptuneNote(context, note, startTime, endTime);

      this.activeNodes.push(scheduled);
      scheduled.source.addEventListener("ended", () => {
        scheduled.source.disconnect();
        scheduled.gain.disconnect();
        this.activeNodes = this.activeNodes.filter((node) => node.source !== scheduled.source);
      });
    }
  }

  private scheduleChiptuneNote(
    context: AudioContext,
    note: ScheduledNote,
    startTime: number,
    endTime: number,
  ): ActiveNode {
    const oscillator = context.createOscillator();
    oscillator.type = note.waveform;
    oscillator.frequency.value = note.frequency;

    const gain = context.createGain();
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(note.gain, startTime + ATTACK_SECONDS);
    gain.gain.setValueAtTime(
      note.gain,
      Math.max(startTime + ATTACK_SECONDS, endTime - RELEASE_SECONDS),
    );
    gain.gain.linearRampToValueAtTime(0, endTime);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startTime);
    oscillator.stop(endTime);

    return { source: oscillator, gain };
  }

  private schedulePianoNote(
    context: AudioContext,
    note: ScheduledNote,
    startTime: number,
    endTime: number,
  ): ActiveNode {
    const samplePitch = nearestSamplePitch(note.pitch);
    const buffer = this.pianoSampler.getBuffer(samplePitch);
    if (!buffer) {
      // isLoaded() was checked in play(), so this is unreachable in
      // practice; degrade to an oscillator rather than throwing mid-loop.
      return this.scheduleChiptuneNote(context, note, startTime, endTime);
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    // Shift the nearest sample (at most 1.5 semitones away) to the exact pitch.
    source.playbackRate.value = Math.pow(2, (note.pitch - samplePitch) / 12);

    // The sample carries its own attack and natural decay; the envelope
    // only gates the note off at its scheduled end.
    const level = note.gain * PIANO_GAIN_MULTIPLIER;
    const gain = context.createGain();
    gain.gain.setValueAtTime(level, startTime);
    gain.gain.setValueAtTime(level, endTime);
    gain.gain.linearRampToValueAtTime(0, endTime + PIANO_RELEASE_SECONDS);

    source.connect(gain);
    gain.connect(this.getPianoBus(context));
    source.start(startTime);
    source.stop(endTime + PIANO_RELEASE_SECONDS);

    return { source, gain };
  }

  /** Immediately silences and disconnects every scheduled note, including ones scheduled in the future. */
  stop(): void {
    const now = this.audioContext?.currentTime ?? 0;
    for (const { source, gain } of this.activeNodes) {
      try {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(0, now);
        source.stop(now);
      } catch {
        // Already stopped; nothing to do.
      }
    }
    this.activeNodes = [];
  }

  dispose(): void {
    this.stop();
    void this.audioContext?.close();
    this.audioContext = null;
    this.pianoBus = null;
  }
}
