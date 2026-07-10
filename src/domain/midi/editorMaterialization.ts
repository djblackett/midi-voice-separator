import type { MidiProject } from "./midiProject";
import { applyVoiceOverrides, type VoiceOverrides } from "./voiceAssignments";
import { buildVoiceList } from "./voiceManagement";

export interface MaterializableEditorState {
  project: MidiProject | null;
  voiceOverrides: VoiceOverrides;
  voiceOrder: readonly string[];
  voiceLabels: Readonly<Record<string, string>>;
}

/**
 * Resolves the one project value every renderer, comparison, playback source,
 * export, and native evaluator should consume: base notes with correction
 * overrides applied and voice summaries rebuilt from editable order/labels.
 */
export function materializeEditorProject(state: MaterializableEditorState): MidiProject | null {
  const { project, voiceOverrides, voiceOrder, voiceLabels } = state;
  if (!project) {
    return null;
  }
  const withOverrides = applyVoiceOverrides(project, voiceOverrides);
  return {
    ...withOverrides,
    voices: buildVoiceList(voiceOrder, voiceLabels, withOverrides.notes),
  };
}
