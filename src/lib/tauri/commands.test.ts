import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getBackendStatus, importMidi } from "./commands";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

describe("tauri command adapter", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("maps backend status success", async () => {
    invokeMock.mockResolvedValue({ status: "ready", application: "Chiptune Voice Separator" });

    await expect(getBackendStatus()).resolves.toEqual({
      status: "ready",
      application: "Chiptune Voice Separator",
    });
    expect(invokeMock).toHaveBeenCalledWith("backend_status");
  });

  it("maps import success", async () => {
    invokeMock.mockResolvedValue({ fileName: "song.mid", notes: [] });

    await expect(importMidi("C:\\music\\song.mid")).resolves.toEqual({
      fileName: "song.mid",
      notes: [],
    });
    expect(invokeMock).toHaveBeenCalledWith("import_midi", { path: "C:\\music\\song.mid" });
  });

  it("preserves structured command errors", async () => {
    invokeMock.mockRejectedValue({ code: "INVALID_MIDI", message: "Invalid MIDI file." });

    await expect(importMidi("bad.txt")).rejects.toEqual({
      code: "INVALID_MIDI",
      message: "Invalid MIDI file.",
    });
  });
});
