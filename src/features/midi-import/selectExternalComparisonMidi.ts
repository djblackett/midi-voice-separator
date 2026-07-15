import { open } from "@tauri-apps/plugin-dialog";

/** Selects a MIDI file that will remain an immutable external comparison reference. */
export async function selectExternalComparisonMidi(): Promise<string | null> {
  const selectedPath = await open({
    multiple: false,
    filters: [
      {
        name: "MIDI files",
        extensions: ["mid", "midi"],
      },
    ],
  });

  return selectedPath === null ? null : selectedPath;
}
