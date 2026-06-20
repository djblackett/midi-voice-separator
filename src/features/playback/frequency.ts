/** Standard MIDI-pitch-to-frequency conversion, A4 (pitch 69) = 440 Hz. */
export function midiPitchToFrequency(pitch: number): number {
  return 440 * Math.pow(2, (pitch - 69) / 12);
}
