import { open } from "@tauri-apps/plugin-dialog";
import { importMidi, type AssignmentOperationResult } from "../../lib/tauri/commands";

export async function selectAndImportMidi(): Promise<AssignmentOperationResult | null> {
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
