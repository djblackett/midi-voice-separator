/**
 * Sampled-piano support for the playback engine, built on the Salamander
 * Grand Piano sample set (see `public/samples/salamander/ATTRIBUTION.md`).
 * The set is sampled every minor third (A, C, D#, F# per octave, A0-C8),
 * so any MIDI pitch is at most 1.5 semitones from a real recording —
 * close enough that playback-rate pitch shifting stays inaudible.
 *
 * The pure pitch-to-sample math lives in exported functions so it's
 * unit-testable; `PianoSampler` itself is thin fetch/decode glue in the
 * same untested-by-convention category as `playbackEngine.ts`.
 */

/** MIDI pitches with a real recording: every 3 semitones from A0 (21) to C8 (108). */
export const SAMPLE_PITCHES: readonly number[] = Array.from(
  { length: 30 },
  (_, index) => 21 + index * 3,
);

const NOTE_NAMES_BY_PITCH_CLASS: Record<number, string> = {
  0: "C",
  3: "Ds",
  6: "Fs",
  9: "A",
};

/** The sampled pitch closest to `pitch`, clamped to the sampled A0-C8 range. */
export function nearestSamplePitch(pitch: number): number {
  const first = SAMPLE_PITCHES[0];
  const last = SAMPLE_PITCHES[SAMPLE_PITCHES.length - 1];
  const clamped = Math.min(last, Math.max(first, pitch));
  return first + Math.round((clamped - first) / 3) * 3;
}

/** File name (e.g. "Ds4.mp3") for a sampled pitch returned by `nearestSamplePitch`. */
export function sampleFileForPitch(samplePitch: number): string {
  const pitchClass = samplePitch % 12;
  const name = NOTE_NAMES_BY_PITCH_CLASS[pitchClass];
  if (name === undefined) {
    throw new Error(`Pitch ${samplePitch} is not one of the sampled pitches`);
  }
  const octave = Math.floor(samplePitch / 12) - 1;
  return `${name}${octave}.mp3`;
}

const SAMPLE_BASE_URL = `${import.meta.env.BASE_URL}samples/salamander/`;

/** Fetches and caches the decoded sample set; safe to call `load` repeatedly. */
export class PianoSampler {
  private buffers = new Map<number, AudioBuffer>();
  private loadPromise: Promise<void> | null = null;

  isLoaded(): boolean {
    return this.buffers.size === SAMPLE_PITCHES.length;
  }

  load(context: AudioContext): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = Promise.all(
        SAMPLE_PITCHES.map(async (samplePitch) => {
          const response = await fetch(SAMPLE_BASE_URL + sampleFileForPitch(samplePitch));
          if (!response.ok) {
            throw new Error(`Failed to fetch piano sample for pitch ${samplePitch}`);
          }
          const buffer = await context.decodeAudioData(await response.arrayBuffer());
          this.buffers.set(samplePitch, buffer);
        }),
      ).then(() => undefined);
      // A failed load (offline, missing file) shouldn't poison the cache
      // forever — clear the promise so a later attempt can retry.
      this.loadPromise.catch(() => {
        this.loadPromise = null;
      });
    }
    return this.loadPromise;
  }

  getBuffer(samplePitch: number): AudioBuffer | null {
    return this.buffers.get(samplePitch) ?? null;
  }
}
