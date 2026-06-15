import { save } from "@tauri-apps/plugin-dialog";
import type { MidiProject } from "../../domain/midi/midiProject";
import { exportMidi, type ExportMidiResult } from "../../lib/tauri/commands";

function defaultExportName(fileName: string): string {
  return fileName.replace(/\.(mid|midi)$/i, "") + "-voices.mid";
}

export async function selectAndExportMidi(project: MidiProject): Promise<ExportMidiResult | null> {
  const selectedPath = await save({
    defaultPath: defaultExportName(project.fileName),
    filters: [
      {
        name: "MIDI files",
        extensions: ["mid"],
      },
    ],
  });

  if (selectedPath === null) {
    return null;
  }

  return exportMidi(selectedPath, project);
}
