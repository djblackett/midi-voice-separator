import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { exportMidi, getBackendStatus, importMidi, reassignVoices } from "./commands";

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

  it("maps export success", async () => {
    const project = { fileName: "song.mid", notes: [] };
    invokeMock.mockResolvedValue({
      path: "C:\\music\\song-voices.mid",
      trackCount: 3,
      noteCount: 12,
    });

    await expect(exportMidi("C:\\music\\song-voices.mid", project as never)).resolves.toEqual({
      path: "C:\\music\\song-voices.mid",
      trackCount: 3,
      noteCount: 12,
    });
    expect(invokeMock).toHaveBeenCalledWith("export_midi", {
      path: "C:\\music\\song-voices.mid",
      project,
    });
  });

  it("maps reassign-voices success with no voice cap", async () => {
    const project = { fileName: "song.mid", notes: [] };
    const locked = { "note-1": "voice-2" };
    invokeMock.mockResolvedValue({ fileName: "song.mid", notes: [] });

    await expect(
      reassignVoices(project as never, locked, undefined, "BALANCED", "GREEDY"),
    ).resolves.toEqual({
      fileName: "song.mid",
      notes: [],
    });
    expect(invokeMock).toHaveBeenCalledWith("reassign_voices", {
      project,
      locked,
      maxVoiceCount: null,
      strategy: "BALANCED",
      mode: "GREEDY",
    });
  });

  it("passes an explicit max voice count, strategy, and assignment mode through to the command", async () => {
    const project = { fileName: "song.mid", notes: [] };
    const locked = {};
    invokeMock.mockResolvedValue({ fileName: "song.mid", notes: [] });

    await reassignVoices(project as never, locked, 4, "REGISTER_PRIORITY", "GLOBAL");

    expect(invokeMock).toHaveBeenCalledWith("reassign_voices", {
      project,
      locked,
      maxVoiceCount: 4,
      strategy: "REGISTER_PRIORITY",
      mode: "GLOBAL",
    });
  });

  it("preserves structured command errors", async () => {
    invokeMock.mockRejectedValue({ code: "INVALID_MIDI", message: "Invalid MIDI file." });

    await expect(importMidi("bad.txt")).rejects.toEqual({
      code: "INVALID_MIDI",
      message: "Invalid MIDI file.",
    });
  });

  it("falls back to an unknown-error code for a plain Error rejection", async () => {
    invokeMock.mockRejectedValue(new Error("the IPC bridge is not available"));

    await expect(importMidi("song.mid")).rejects.toEqual({
      code: "UNKNOWN_ERROR",
      message: "the IPC bridge is not available",
    });
  });

  it("falls back to a generic message for a rejection with no Error and no structured shape", async () => {
    invokeMock.mockRejectedValue("a plain string rejection");

    await expect(importMidi("song.mid")).rejects.toEqual({
      code: "UNKNOWN_ERROR",
      message: "An unexpected application error occurred.",
    });
  });

  it("maps backend status errors", async () => {
    invokeMock.mockRejectedValue({ code: "BACKEND_UNAVAILABLE", message: "Backend not ready." });

    await expect(getBackendStatus()).rejects.toEqual({
      code: "BACKEND_UNAVAILABLE",
      message: "Backend not ready.",
    });
  });

  it("maps export errors", async () => {
    const project = { fileName: "song.mid", notes: [] };
    invokeMock.mockRejectedValue({ code: "WRITE_FAILED", message: "Could not write file." });

    await expect(exportMidi("C:\\music\\song.mid", project as never)).rejects.toEqual({
      code: "WRITE_FAILED",
      message: "Could not write file.",
    });
  });

  it("maps reassign-voices errors", async () => {
    const project = { fileName: "song.mid", notes: [] };
    invokeMock.mockRejectedValue({ code: "INVALID_MIDI", message: "Bad project state." });

    await expect(
      reassignVoices(project as never, {}, undefined, "BALANCED", "GREEDY"),
    ).rejects.toEqual({
      code: "INVALID_MIDI",
      message: "Bad project state.",
    });
  });
});
