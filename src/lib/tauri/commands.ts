import { invoke } from "@tauri-apps/api/core";
import type { MidiProject } from "../../domain/midi/midiProject";

const COMMANDS = {
  backendStatus: "backend_status",
  importMidi: "import_midi",
} as const;

export interface BackendStatus {
  status: "ready";
  application: string;
}

export interface AppCommandError {
  code: string;
  message: string;
}

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
