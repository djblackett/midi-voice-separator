import type { MidiNote } from "./midiProject";
import type { VoiceOverrides } from "./voiceAssignments";

export interface PitchMarker {
  id: string;
  label: string;
  pitch: number;
}

export type VoiceRangeBoundary = "above" | "between" | "below";

export interface VoiceRangeRule {
  id: string;
  label: string;
  voiceId: string;
  boundary: VoiceRangeBoundary;
  upperMarkerId?: string;
  lowerMarkerId?: string;
}

export function clampMidiPitch(pitch: number): number {
  if (!Number.isFinite(pitch)) {
    return 0;
  }

  return Math.max(0, Math.min(127, Math.round(pitch)));
}

export function buildDefaultPitchMarkers(notes: readonly MidiNote[]): PitchMarker[] {
  if (notes.length === 0) {
    return [
      { id: "marker-1", label: "Marker 1", pitch: 72 },
      { id: "marker-2", label: "Marker 2", pitch: 60 },
    ];
  }

  const pitches = notes.map((note) => note.pitch);
  const lowestPitch = Math.min(...pitches);
  const highestPitch = Math.max(...pitches);
  const span = Math.max(2, highestPitch - lowestPitch);

  return [
    {
      id: "marker-1",
      label: "Marker 1",
      pitch: clampMidiPitch(lowestPitch + Math.round((span * 2) / 3)),
    },
    {
      id: "marker-2",
      label: "Marker 2",
      pitch: clampMidiPitch(lowestPitch + Math.round(span / 3)),
    },
  ];
}

export function buildDefaultVoiceRangeRules(voiceIds: readonly string[]): VoiceRangeRule[] {
  const rules: VoiceRangeRule[] = [];
  const [firstVoiceId, secondVoiceId, thirdVoiceId] = voiceIds;

  if (firstVoiceId) {
    rules.push({
      id: "range-above-marker-1",
      label: "Above Marker 1",
      voiceId: firstVoiceId,
      boundary: "above",
      upperMarkerId: "marker-1",
    });
  }

  if (secondVoiceId) {
    rules.push({
      id: "range-between-marker-2-marker-1",
      label: "Marker 2 to Marker 1",
      voiceId: secondVoiceId,
      boundary: "between",
      lowerMarkerId: "marker-2",
      upperMarkerId: "marker-1",
    });
  }

  if (thirdVoiceId) {
    rules.push({
      id: "range-below-marker-2",
      label: "Below Marker 2",
      voiceId: thirdVoiceId,
      boundary: "below",
      lowerMarkerId: "marker-2",
    });
  }

  return rules;
}

export function describePitchRangeRule(
  rule: VoiceRangeRule,
  markers: readonly PitchMarker[],
): string {
  const markerById = new Map(markers.map((marker) => [marker.id, marker]));
  const lowerMarker = rule.lowerMarkerId ? markerById.get(rule.lowerMarkerId) : undefined;
  const upperMarker = rule.upperMarkerId ? markerById.get(rule.upperMarkerId) : undefined;

  if (rule.boundary === "above" && upperMarker) {
    return `Pitch > ${upperMarker.pitch}`;
  }

  if (rule.boundary === "below" && lowerMarker) {
    return `Pitch <= ${lowerMarker.pitch}`;
  }

  if (rule.boundary === "between" && lowerMarker && upperMarker) {
    const low = Math.min(lowerMarker.pitch, upperMarker.pitch);
    const high = Math.max(lowerMarker.pitch, upperMarker.pitch);
    return `${low} < pitch <= ${high}`;
  }

  return "Incomplete range";
}

export function noteMatchesVoiceRangeRule(
  note: Pick<MidiNote, "pitch">,
  rule: VoiceRangeRule,
  markers: readonly PitchMarker[],
): boolean {
  const markerById = new Map(markers.map((marker) => [marker.id, marker]));
  const lowerMarker = rule.lowerMarkerId ? markerById.get(rule.lowerMarkerId) : undefined;
  const upperMarker = rule.upperMarkerId ? markerById.get(rule.upperMarkerId) : undefined;

  if (rule.boundary === "above") {
    return upperMarker ? note.pitch > upperMarker.pitch : false;
  }

  if (rule.boundary === "below") {
    return lowerMarker ? note.pitch <= lowerMarker.pitch : false;
  }

  if (!lowerMarker || !upperMarker) {
    return false;
  }

  const low = Math.min(lowerMarker.pitch, upperMarker.pitch);
  const high = Math.max(lowerMarker.pitch, upperMarker.pitch);
  return note.pitch > low && note.pitch <= high;
}

export function buildVoiceOverridesFromRangeRules(
  notes: readonly MidiNote[],
  markers: readonly PitchMarker[],
  rules: readonly VoiceRangeRule[],
): VoiceOverrides {
  const patch: VoiceOverrides = {};

  for (const note of notes) {
    const matchingRule = rules.find((rule) => noteMatchesVoiceRangeRule(note, rule, markers));
    if (matchingRule) {
      patch[note.id] = matchingRule.voiceId;
    }
  }

  return patch;
}

/**
 * Merges a freshly computed range patch into the current overrides, but
 * skips any note that already has an override the previous range
 * application didn't make (i.e. a hand correction layered on top) — so
 * nudging a marker and reapplying ranges doesn't silently undo edits the
 * user made after the last apply. Notes the patch newly assigns become
 * range-assigned themselves, so a later reapply can still adjust them.
 */
export function applyRangePatchPreservingHandCorrections(
  currentOverrides: VoiceOverrides,
  rangeAssignedNoteIds: ReadonlySet<string>,
  rangePatch: VoiceOverrides,
): { overrides: VoiceOverrides; rangeAssignedNoteIds: Set<string> } {
  const overrides = { ...currentOverrides };
  const nextRangeAssignedNoteIds = new Set(rangeAssignedNoteIds);

  for (const [noteId, voiceId] of Object.entries(rangePatch)) {
    const isHandCorrected =
      Object.prototype.hasOwnProperty.call(currentOverrides, noteId) &&
      !rangeAssignedNoteIds.has(noteId);
    if (isHandCorrected) {
      continue;
    }
    overrides[noteId] = voiceId;
    nextRangeAssignedNoteIds.add(noteId);
  }

  return { overrides, rangeAssignedNoteIds: nextRangeAssignedNoteIds };
}
