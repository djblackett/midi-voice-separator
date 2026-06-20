import { invoke } from "@tauri-apps/api/core";
import type { MidiProject } from "../../domain/midi/midiProject";

const COMMANDS = {
  backendStatus: "backend_status",
  importMidi: "import_midi",
  exportMidi: "export_midi",
  reassignVoices: "reassign_voices",
} as const;

export interface BackendStatus {
  status: "ready";
  application: string;
}

export interface AppCommandError {
  code: string;
  message: string;
}

export interface ExportMidiResult {
  path: string;
  trackCount: number;
  noteCount: number;
}

/**
 * Cost-model weighting "Re-run separation" scores unlocked notes with.
 * Different files respond differently — see `SeparationStrategy` in
 * `voice_assignment.rs` for what each preset actually weights.
 */
export type SeparationStrategy =
  | "BALANCED"
  | "CHANNEL_PRIORITY"
  | "REGISTER_PRIORITY"
  | "STRICT_CHANNEL";

function toCommandError(error: unknown): AppCommandError {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    typeof error.code === "string" &&
    typeof error.message === "string"
  ) {
    return { code: error.code, message: error.message };
  }

  return {
    code: "UNKNOWN_ERROR",
    message: error instanceof Error ? error.message : "An unexpected application error occurred.",
  };
}

export async function getBackendStatus(): Promise<BackendStatus> {
  try {
    return await invoke<BackendStatus>(COMMANDS.backendStatus);
  } catch (error) {
    throw toCommandError(error);
  }
}

export async function importMidi(path: string): Promise<MidiProject> {
  try {
    return await invoke<MidiProject>(COMMANDS.importMidi, { path });
  } catch (error) {
    throw toCommandError(error);
  }
}

export async function exportMidi(path: string, project: MidiProject): Promise<ExportMidiResult> {
  try {
    return await invoke<ExportMidiResult>(COMMANDS.exportMidi, { path, project });
  } catch (error) {
    throw toCommandError(error);
  }
}

export async function reassignVoices(
  project: MidiProject,
  locked: Record<string, string>,
  maxVoiceCount: number | undefined,
  strategy: SeparationStrategy,
): Promise<MidiProject> {
  try {
    return await invoke<MidiProject>(COMMANDS.reassignVoices, {
      project,
      locked,
      maxVoiceCount: maxVoiceCount ?? null,
      strategy,
    });
  } catch (error) {
    throw toCommandError(error);
  }
}
