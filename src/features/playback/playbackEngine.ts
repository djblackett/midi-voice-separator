import type { ScheduledNote } from "./scheduledNotes";

const ATTACK_SECONDS = 0.005;
const RELEASE_SECONDS = 0.02;

interface ActiveNode {
  oscillator: OscillatorNode;
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

  private getAudioContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }
    return this.audioContext;
  }

  getCurrentTime(): number {
    return this.audioContext?.currentTime ?? 0;
  }

  /** Schedules every note in `scheduledNotes`, relative to "now". */
  play(scheduledNotes: readonly ScheduledNote[]): void {
    const context = this.getAudioContext();
    // Chrome's autoplay policy can leave a freshly-created AudioContext
    // suspended even when constructed inside a user-gesture handler (the
    // Play button's click); without an explicit resume(), playback would
    // silently produce no sound rather than erroring.
    if (context.state === "suspended") {
      void context.resume();
    }
    const now = context.currentTime;

    for (const note of scheduledNotes) {
      const startTime = now + note.startSeconds;
      const endTime = Math.max(startTime + ATTACK_SECONDS, now + note.endSeconds);

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

      this.activeNodes.push({ oscillator, gain });
      oscillator.addEventListener("ended", () => {
        oscillator.disconnect();
        gain.disconnect();
        this.activeNodes = this.activeNodes.filter((node) => node.oscillator !== oscillator);
      });
    }
  }

  /** Immediately silences and disconnects every scheduled note, including ones scheduled in the future. */
  stop(): void {
    const now = this.audioContext?.currentTime ?? 0;
    for (const { oscillator, gain } of this.activeNodes) {
      try {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(0, now);
        oscillator.stop(now);
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
  }
}
