import type { VoiceCorrespondence } from "../../domain/midi/voiceCorrespondence";
import type { BranchId } from "./editorBranch";

export type LinkedLaneResolution =
  | {
      readonly kind: "matched";
      readonly targetSide: BranchId;
      readonly targetVoiceId: string;
    }
  | {
      readonly kind: "unresolved";
      readonly targetSide: BranchId;
      readonly reason: "missing-correspondence" | "unmatched" | "ambiguous";
    };

function isAmbiguous(
  correspondence: VoiceCorrespondence,
  side: BranchId,
  voiceId: string,
): boolean {
  return correspondence.ambiguous.some((entry) => entry.side === side && entry.voiceId === voiceId);
}

export function resolveLinkedLaneTarget(
  sourceSide: BranchId,
  sourceVoiceId: string,
  correspondence: VoiceCorrespondence | null,
): LinkedLaneResolution {
  const targetSide: BranchId = sourceSide === "A" ? "B" : "A";
  if (!correspondence) {
    return { kind: "unresolved", targetSide, reason: "missing-correspondence" };
  }
  if (isAmbiguous(correspondence, sourceSide, sourceVoiceId)) {
    return { kind: "unresolved", targetSide, reason: "ambiguous" };
  }

  const pair = correspondence.matched.find((candidate) =>
    sourceSide === "A"
      ? candidate.aVoiceId === sourceVoiceId
      : candidate.bVoiceId === sourceVoiceId,
  );
  if (!pair) {
    return { kind: "unresolved", targetSide, reason: "unmatched" };
  }

  const targetVoiceId = sourceSide === "A" ? pair.bVoiceId : pair.aVoiceId;

  return isAmbiguous(correspondence, targetSide, targetVoiceId)
    ? { kind: "unresolved", targetSide, reason: "ambiguous" }
    : { kind: "matched", targetSide, targetVoiceId };
}
