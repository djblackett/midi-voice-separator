import type { VoiceCorrespondence } from "../../domain/midi/voiceCorrespondence";

/**
 * A presentation key is the canonical color/timbre bucket a voice renders and
 * (later) sounds as -- NOT a domain voice id. Two voices that should look and
 * sound like "the same musical part" across a comparison share one key.
 */
export type PresentationKey = string;

export interface PresentationKeyMap {
  keyForSide(side: string, voiceId: string): PresentationKey;
}

export interface PresentationKeySides {
  readonly canonical: string;
  readonly matched: string;
}

/**
 * Maps each visible voice slot to the palette/timbre key used by the same
 * number-key shortcut. Internal voice ids may be reallocated by a re-run;
 * visible slot 1 must still look and sound like slot 1.
 */
export function deriveVoiceOrderPresentationKeys(
  voiceIds: readonly string[],
): ReadonlyMap<string, PresentationKey> {
  return new Map(voiceIds.map((voiceId, index) => [voiceId, `voice-${index + 1}`]));
}

/**
 * Derives per-side presentation keys from voice correspondence (M10). A voices
 * keep their own key (so a lone side is unchanged); a matched B voice reuses
 * its A partner's key so it renders in the partner's color; an unmatched B voice
 * keeps its own. Percussion, matched to itself by role, keeps its semantic key.
 * Domain voice ids are never rewritten (M8) -- consumers map ids to keys here.
 */
export function derivePresentationKeys(
  correspondence: VoiceCorrespondence,
  sides: PresentationKeySides = { canonical: "A", matched: "B" },
): PresentationKeyMap {
  const aPartnerByBVoiceId = new Map<string, string>();
  for (const pair of correspondence.matched) {
    aPartnerByBVoiceId.set(pair.bVoiceId, pair.aVoiceId);
  }
  return {
    keyForSide(side, voiceId) {
      if (side === sides.canonical) {
        return voiceId;
      }
      return side === sides.matched ? (aPartnerByBVoiceId.get(voiceId) ?? voiceId) : voiceId;
    },
  };
}

/**
 * The presentation map for rendering a single side with no comparison: every
 * voice is its own bucket, so colors match today's voice-id-derived behavior.
 */
export const IDENTITY_PRESENTATION_KEYS: PresentationKeyMap = {
  keyForSide: (_side, voiceId) => voiceId,
};
