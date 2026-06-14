import { open } from "@tauri-apps/plugin-dialog";
import { importMidi } from "../../lib/tauri/commands";
import type { MidiProject } from "../../domain/midi/midiProject";

export async function selectAndImportMidi(): Promise<MidiProject | null> {
  const selectedPath = await open({
    multiple: false,
    filters: [
      {
        name: "MIDI files",
        extensions: ["mid", "midi"],
      },
    ],
  });

  if (selectedPath === null) {
    return null;
  }

  return importMidi(selectedPath);
}
