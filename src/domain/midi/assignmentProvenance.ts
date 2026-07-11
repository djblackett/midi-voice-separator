import type { SeparationStrategy } from "./midiProject";

/**
 * Backend-minted record of the base assignment's origin. Manual corrections,
 * next-rerun presets, and evaluation profiles intentionally stay separate.
 */
export type AssignmentProvenance =
  | { readonly kind: "imported"; readonly algorithmVersion: number }
  | { readonly kind: "appExportedVoiceTracks" }
  | {
      readonly kind: "reassigned";
      readonly strategy: SeparationStrategy;
      readonly mode: "GREEDY" | "GLOBAL" | "CONTIG";
      readonly maxVoiceCount: number | null;
      readonly algorithmVersion: number;
    };
