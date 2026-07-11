import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  evaluateAssignment,
  exportMidi,
  getBackendStatus,
  importMidi,
  reassignVoices,
} from "./commands";

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
    const result = {
      project: { fileName: "song.mid", notes: [] },
      provenance: { kind: "imported", algorithmVersion: 1 },
    };
    invokeMock.mockResolvedValue(result);

    await expect(importMidi("C:\\music\\song.mid")).resolves.toEqual(result);
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
    const result = {
      project: { fileName: "song.mid", notes: [] },
      provenance: {
        kind: "reassigned",
        strategy: "BALANCED",
        mode: "GREEDY",
        maxVoiceCount: null,
        algorithmVersion: 1,
      },
    };
    invokeMock.mockResolvedValue(result);

    await expect(
      reassignVoices(project as never, locked, undefined, "BALANCED", "GREEDY"),
    ).resolves.toEqual(result);
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
    invokeMock.mockResolvedValue({
      project: { fileName: "song.mid", notes: [] },
      provenance: {
        kind: "reassigned",
        strategy: "REGISTER_PRIORITY",
        mode: "GLOBAL",
        maxVoiceCount: 4,
        algorithmVersion: 1,
      },
    });

    await reassignVoices(project as never, locked, 4, "REGISTER_PRIORITY", "GLOBAL");

    expect(invokeMock).toHaveBeenCalledWith("reassign_voices", {
      project,
      locked,
      maxVoiceCount: 4,
      strategy: "REGISTER_PRIORITY",
      mode: "GLOBAL",
    });
  });

  it("passes only the explicit evaluation request to assignment cost", async () => {
    const request = {
      ppq: 480,
      notes: [],
      profile: { id: "GENERAL_PURPOSE" as const, version: 1 },
    };
    const report = {
      metric: { id: "ASSIGNMENT_MODEL_COST", version: 1 },
      profile: request.profile,
      melodicNoteCount: 0,
      excludedPercussionNoteCount: 0,
      melodicVoiceCount: 0,
      components: [],
      totalCost: 0,
      hardViolations: [],
    };
    invokeMock.mockResolvedValue(report);

    await expect(evaluateAssignment(request)).resolves.toEqual(report);
    expect(invokeMock).toHaveBeenCalledWith("evaluate_assignment", { request });
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

  it("maps assignment evaluation errors", async () => {
    invokeMock.mockRejectedValue({
      code: "INVALID_ASSIGNMENT_EVALUATION",
      message: "Assignment cost requires a positive PPQ value.",
    });

    await expect(
      evaluateAssignment({
        ppq: 0,
        notes: [],
        profile: { id: "GENERAL_PURPOSE", version: 1 },
      }),
    ).rejects.toEqual({
      code: "INVALID_ASSIGNMENT_EVALUATION",
      message: "Assignment cost requires a positive PPQ value.",
    });
  });
});
