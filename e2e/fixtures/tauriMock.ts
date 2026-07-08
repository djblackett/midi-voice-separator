import type { Page } from "@playwright/test";
import type { MidiNote, MidiProject, MidiVoice } from "../../src/domain/midi/midiProject";

/**
 * Fakes the Tauri IPC boundary so Playwright can drive the real frontend
 * bundle (served by the Vite dev server) without a native Tauri window --
 * no `tauri-driver`/WebDriver is configured for this project. This matches
 * `@tauri-apps/api/core`'s `invoke(cmd, args)` -> `window.__TAURI_INTERNALS__.invoke(cmd, args)`
 * contract and `@tauri-apps/plugin-dialog`'s `plugin:dialog|open`/`|save`
 * commands.
 *
 * Only the native OS boundary (file dialog, Rust IPC) is substituted --
 * every test still exercises the real production frontend code. Register
 * this before `page.goto`, since it relies on `page.exposeFunction` and
 * `page.addInitScript` both being present for the page's first script
 * execution.
 */
export interface ReassignArgs {
  project: MidiProject;
  locked: Record<string, string>;
  maxVoiceCount: number | null;
  strategy: string;
  mode: string;
}

export interface CommandError {
  code: string;
  message: string;
}

export interface TauriMockOptions {
  importedProject: MidiProject;
  /** Called for the "Re-run separation" command; defaults to a no-op (returns the project unchanged). */
  reassign?: (args: ReassignArgs) => MidiProject;
  importPath?: string;
  exportPath?: string;
  /** When set, `import_midi` rejects with this instead of resolving `importedProject`. */
  importError?: CommandError;
  /** When set, `export_midi` rejects with this instead of resolving a success result. */
  exportError?: CommandError;
  /** When set, `reassign_voices` rejects with this instead of calling `reassign`. */
  reassignError?: CommandError;
}

export async function installFakeTauri(page: Page, options: TauriMockOptions): Promise<void> {
  const importPath = options.importPath ?? "C:/fake/fixture.mid";
  const exportPath = options.exportPath ?? "C:/fake/out.mid";

  await page.exposeFunction("__fakeReassign", (args: ReassignArgs) =>
    options.reassign ? options.reassign(args) : args.project,
  );

  await page.addInitScript(
    ({ importedProject, importPath, exportPath, importError, exportError, reassignError }) => {
      (
        window as unknown as { __TAURI_EVENT_PLUGIN_INTERNALS__: unknown }
      ).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
      (
        window as unknown as {
          __TAURI_INTERNALS__: {
            transformCallback: (cb: unknown) => unknown;
            metadata: { currentWebview: { label: string }; currentWindow: { label: string } };
            invoke: (cmd: string, args: unknown) => Promise<unknown>;
          };
        }
      ).__TAURI_INTERNALS__ = {
        transformCallback: (cb) => cb,
        metadata: {
          currentWebview: { label: "main" },
          currentWindow: { label: "main" },
        },
        invoke: async (cmd, args) => {
          if (cmd === "backend_status") {
            return { status: "ready", application: "chiptune-voice-separator" };
          }
          if (cmd === "import_midi") {
            if (importError) {
              throw importError;
            }
            return importedProject;
          }
          if (cmd === "plugin:dialog|open") {
            return importPath;
          }
          if (cmd === "plugin:dialog|save") {
            return exportPath;
          }
          if (cmd === "plugin:event|listen" || cmd === "plugin:event|unlisten") {
            return 0;
          }
          if (cmd === "export_midi") {
            if (exportError) {
              throw exportError;
            }
            const project = (args as { project: { notes: unknown[]; voices: unknown[] } }).project;
            return {
              path: exportPath,
              trackCount: project.voices.length + 1,
              noteCount: project.notes.length,
            };
          }
          if (cmd === "reassign_voices") {
            if (reassignError) {
              throw reassignError;
            }
            return (
              window as unknown as { __fakeReassign: (a: unknown) => Promise<unknown> }
            ).__fakeReassign(args);
          }
          throw new Error(`Unhandled fake invoke: ${cmd}`);
        },
      };
    },
    {
      importedProject: options.importedProject,
      importPath,
      exportPath,
      importError: options.importError,
      exportError: options.exportError,
      reassignError: options.reassignError,
    },
  );
}

export function note(
  id: string,
  voiceId: string,
  pitch: number,
  startTick: number,
  overrides: Partial<MidiNote> = {},
): MidiNote {
  return {
    id,
    voiceId,
    sourceTrackIndex: 0,
    channel: 0,
    pitch,
    velocity: 100,
    startTick,
    endTick: startTick + 120,
    durationTicks: 120,
    assignmentConfidence: 0.9,
    assignmentReason: "CLOSEST_PITCH",
    ...overrides,
  };
}

export function voice(
  id: string,
  label: string,
  noteCount: number,
  lowestPitch: number,
  highestPitch: number,
): MidiVoice {
  return { id, label, noteCount, lowestPitch, highestPitch };
}

export function buildFixtureProject(
  notes: MidiNote[],
  voices: MidiVoice[],
  overrides: Partial<MidiProject> = {},
): MidiProject {
  return {
    fileName: "fixture.mid",
    format: "single",
    ppq: 480,
    durationTicks: Math.max(960, ...notes.map((n) => n.endTick)),
    trackCount: voices.length,
    voices,
    notes,
    tempoChanges: [],
    timeSignatures: [],
    warnings: [],
    separationSummary: {
      meanConfidence: 0.9,
      lowConfidenceNoteCount: 0,
      voiceCount: voices.length,
    },
    strategySuggestion: { strategy: "BALANCED", reason: "fixture" },
    ...overrides,
  };
}
