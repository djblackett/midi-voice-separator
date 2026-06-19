import { save } from "@tauri-apps/plugin-dialog";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { exportMidi } from "../../lib/tauri/commands";
import { selectAndExportMidi } from "./exportMidi";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
}));

vi.mock("../../lib/tauri/commands", () => ({
  exportMidi: vi.fn(),
}));

const saveMock = vi.mocked(save);
const exportMidiMock = vi.mocked(exportMidi);

describe("selectAndExportMidi", () => {
  beforeEach(() => {
    saveMock.mockReset();
    exportMidiMock.mockReset();
  });

  it("returns null without exporting when the dialog is cancelled", async () => {
    saveMock.mockResolvedValue(null);

    await expect(selectAndExportMidi({ fileName: "song.mid" } as never)).resolves.toBeNull();
    expect(exportMidiMock).not.toHaveBeenCalled();
  });

  it("exports to whatever path the dialog returns", async () => {
    saveMock.mockResolvedValue("C:\\music\\song-voices.mid");
    const result = { path: "C:\\music\\song-voices.mid", trackCount: 2, noteCount: 4 };
    exportMidiMock.mockResolvedValue(result);
    const project = { fileName: "song.mid" } as never;

    await expect(selectAndExportMidi(project)).resolves.toBe(result);
    expect(exportMidiMock).toHaveBeenCalledWith("C:\\music\\song-voices.mid", project);
  });

  it("suggests a -voices.mid default export name derived from the source file", async () => {
    saveMock.mockResolvedValue(null);

    await selectAndExportMidi({ fileName: "My Song.midi" } as never);

    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "My Song-voices.mid" }),
    );
  });

  it("strips a .mid extension the same way as .midi", async () => {
    saveMock.mockResolvedValue(null);

    await selectAndExportMidi({ fileName: "song.mid" } as never);

    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "song-voices.mid" }),
    );
  });
});
