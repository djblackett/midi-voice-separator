import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { UnlistenFn } from "@tauri-apps/api/event";

export interface FileDropHandlers {
  /** Called whenever a drag carrying files enters/moves over the window, or leaves/completes it. */
  onDragActive: (isActive: boolean) => void;
  /** Called with the first dropped path that has a `.mid`/`.midi` extension. */
  onDrop: (path: string) => void;
}

function isMidiPath(path: string): boolean {
  const lowerCasePath = path.toLowerCase();
  return lowerCasePath.endsWith(".mid") || lowerCasePath.endsWith(".midi");
}

/**
 * Listens for native OS file drag-and-drop over the app window. Tauri 2
 * intercepts drag-and-drop at the webview level (see `onDragDropEvent`)
 * rather than firing ordinary HTML5 `dragover`/`drop` DOM events with real
 * filesystem paths, so this is the supported way to get an absolute path
 * back from a drop rather than a browser `File` with no path.
 *
 * Mirrors the "Import MIDI" button's own dialog filter (`extensions: ["mid", "midi"]`)
 * by silently ignoring a drop that contains no MIDI file, instead of
 * forwarding it to `import_midi` for the backend to reject -- the button
 * path structurally can't produce a non-MIDI selection, so drop shouldn't
 * surface an error for one either.
 */
export function listenForMidiFileDrop(handlers: FileDropHandlers): Promise<UnlistenFn> {
  return getCurrentWebview().onDragDropEvent((event) => {
    switch (event.payload.type) {
      case "enter":
      case "over":
        handlers.onDragActive(true);
        break;
      case "drop": {
        handlers.onDragActive(false);
        const midiPath = event.payload.paths.find(isMidiPath);
        if (midiPath) {
          handlers.onDrop(midiPath);
        }
        break;
      }
      case "leave":
        handlers.onDragActive(false);
        break;
    }
  });
}
