import { correspondVoices, type CorrespondenceSide } from "./voiceCorrespondence";

export interface ReconciledVoices {
  readonly voiceOrder: string[];
  readonly voiceLabels: Record<string, string>;
  /** old voice id -> new voice id for corresponding voices (for active/solo remap). */
  readonly oldToNew: Map<string, string>;
}

/**
 * Reconciles voice metadata across a re-run through voice correspondence (M9),
 * instead of carrying it forward by raw voice id. A full re-run reallocates
 * voice ids for the same musical grouping, so matching the old assignment to
 * the new one lets the user's order and labels -- and the active/solo voice --
 * follow the voices they belong to rather than being orphaned.
 */
export function reconcileVoicesAfterReassign(
  before: CorrespondenceSide,
  after: CorrespondenceSide,
  previousVoiceOrder: readonly string[],
  previousVoiceLabels: Readonly<Record<string, string>>,
): ReconciledVoices {
  const correspondence = correspondVoices(before, after);
  const oldToNew = new Map(correspondence.matched.map((pair) => [pair.aVoiceId, pair.bVoiceId]));
  const newToOld = new Map(correspondence.matched.map((pair) => [pair.bVoiceId, pair.aVoiceId]));

  // Preserve the user's ordering: each corresponding voice keeps its old slot,
  // then any brand-new voices follow in the re-run's own order.
  const voiceOrder: string[] = [];
  for (const oldVoiceId of previousVoiceOrder) {
    const newVoiceId = oldToNew.get(oldVoiceId);
    if (newVoiceId !== undefined && !voiceOrder.includes(newVoiceId)) {
      voiceOrder.push(newVoiceId);
    }
  }
  for (const newVoiceId of after.voiceIds) {
    if (!voiceOrder.includes(newVoiceId)) {
      voiceOrder.push(newVoiceId);
    }
  }

  // Carry each corresponding voice's label onto its new id; new voices keep the
  // re-run's defaults (no entry).
  const voiceLabels: Record<string, string> = {};
  for (const newVoiceId of after.voiceIds) {
    const oldVoiceId = newToOld.get(newVoiceId);
    if (oldVoiceId !== undefined && previousVoiceLabels[oldVoiceId] !== undefined) {
      voiceLabels[newVoiceId] = previousVoiceLabels[oldVoiceId];
    }
  }

  return { voiceOrder, voiceLabels, oldToNew };
}
