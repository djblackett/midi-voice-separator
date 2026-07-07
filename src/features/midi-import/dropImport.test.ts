import { describe, expect, it, vi } from "vitest";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listenForMidiFileDrop } from "./dropImport";

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: vi.fn(),
}));

type DragDropHandler = (event: { payload: unknown }) => void;

function setUpWebviewMock() {
  let capturedHandler: DragDropHandler | undefined;
  const onDragDropEvent = vi.fn((handler: DragDropHandler) => {
    capturedHandler = handler;
    return Promise.resolve(vi.fn());
  });
  vi.mocked(getCurrentWebview).mockReturnValue({ onDragDropEvent } as never);

  return {
    fire: (payload: unknown) => capturedHandler?.({ payload }),
  };
}

describe("listenForMidiFileDrop", () => {
  it("reports drag-active on enter and over", async () => {
    const webview = setUpWebviewMock();
    const onDragActive = vi.fn();
    await listenForMidiFileDrop({ onDragActive, onDrop: vi.fn() });

    webview.fire({ type: "enter", paths: ["C:\\music\\song.mid"], position: {} });
    webview.fire({ type: "over", position: {} });

    expect(onDragActive).toHaveBeenNthCalledWith(1, true);
    expect(onDragActive).toHaveBeenNthCalledWith(2, true);
  });

  it("clears drag-active and imports the dropped MIDI path", async () => {
    const webview = setUpWebviewMock();
    const onDragActive = vi.fn();
    const onDrop = vi.fn();
    await listenForMidiFileDrop({ onDragActive, onDrop });

    webview.fire({ type: "drop", paths: ["C:\\music\\song.mid"], position: {} });

    expect(onDragActive).toHaveBeenCalledWith(false);
    expect(onDrop).toHaveBeenCalledWith("C:\\music\\song.mid");
  });

  it("ignores a drop with no MIDI file, without calling onDrop", async () => {
    const webview = setUpWebviewMock();
    const onDrop = vi.fn();
    await listenForMidiFileDrop({ onDragActive: vi.fn(), onDrop });

    webview.fire({ type: "drop", paths: ["C:\\images\\cover.png"], position: {} });

    expect(onDrop).not.toHaveBeenCalled();
  });

  it("picks the first MIDI path (case-insensitive extension) among several dropped files", async () => {
    const webview = setUpWebviewMock();
    const onDrop = vi.fn();
    await listenForMidiFileDrop({ onDragActive: vi.fn(), onDrop });

    webview.fire({
      type: "drop",
      paths: ["C:\\readme.txt", "C:\\music\\SONG.MIDI", "C:\\music\\other.mid"],
      position: {},
    });

    expect(onDrop).toHaveBeenCalledWith("C:\\music\\SONG.MIDI");
  });

  it("reports drag-active false on leave", async () => {
    const webview = setUpWebviewMock();
    const onDragActive = vi.fn();
    await listenForMidiFileDrop({ onDragActive, onDrop: vi.fn() });

    webview.fire({ type: "leave" });

    expect(onDragActive).toHaveBeenCalledWith(false);
  });
});
