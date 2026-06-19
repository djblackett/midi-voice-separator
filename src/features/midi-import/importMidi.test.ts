import { open } from "@tauri-apps/plugin-dialog";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { importMidi } from "../../lib/tauri/commands";
import { selectAndImportMidi } from "./importMidi";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("../../lib/tauri/commands", () => ({
  importMidi: vi.fn(),
}));

const openMock = vi.mocked(open);
const importMidiMock = vi.mocked(importMidi);

describe("selectAndImportMidi", () => {
  beforeEach(() => {
    openMock.mockReset();
    importMidiMock.mockReset();
  });

  it("returns null without importing when the dialog is cancelled", async () => {
    openMock.mockResolvedValue(null);

    await expect(selectAndImportMidi()).resolves.toBeNull();
    expect(importMidiMock).not.toHaveBeenCalled();
  });

  it("imports whatever path the dialog returns", async () => {
    openMock.mockResolvedValue("C:\\music\\song.mid");
    const project = { fileName: "song.mid" } as never;
    importMidiMock.mockResolvedValue(project);

    await expect(selectAndImportMidi()).resolves.toBe(project);
    expect(importMidiMock).toHaveBeenCalledWith("C:\\music\\song.mid");
  });

  it("restricts the dialog to MIDI file extensions", async () => {
    openMock.mockResolvedValue(null);

    await selectAndImportMidi();

    expect(openMock).toHaveBeenCalledWith(
      expect.objectContaining({
        multiple: false,
        filters: [expect.objectContaining({ extensions: ["mid", "midi"] })],
      }),
    );
  });
});
