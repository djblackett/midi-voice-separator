import type { Page } from "@playwright/test";
import type { MidiNote, MidiProject, MidiVoice } from "../../src/domain/midi/midiProject";
import type {
  AssignmentEvaluationRequest,
  AssignmentMetricComponent,
  AssignmentMetricReport,
} from "../../src/domain/midi/assignmentMetric";
import type {
  CrossImportComparisonRequest,
  CrossImportComparisonResponse,
} from "../../src/lib/tauri/commands";

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
  reassign?: (args: ReassignArgs) => MidiProject | Promise<MidiProject>;
  /** Called for the derived assignment-cost command; defaults to a deterministic minimal report. */
  evaluateAssignment?: (
    request: AssignmentEvaluationRequest,
  ) => AssignmentMetricReport | Promise<AssignmentMetricReport>;
  compareExternal?: (
    request: CrossImportComparisonRequest,
  ) => CrossImportComparisonResponse | Promise<CrossImportComparisonResponse>;
  importPath?: string;
  exportPath?: string;
  /** When set, `import_midi` rejects with this instead of resolving `importedProject`. */
  importError?: CommandError;
  /** When set, `export_midi` rejects with this instead of resolving a success result. */
  exportError?: CommandError;
  /** When set, `reassign_voices` rejects with this instead of calling `reassign`. */
  reassignError?: CommandError;
  compareExternalError?: CommandError;
}

export async function installFakeTauri(page: Page, options: TauriMockOptions): Promise<void> {
  const importPath = options.importPath ?? "C:/fake/fixture.mid";
  const exportPath = options.exportPath ?? "C:/fake/out.mid";

  await page.exposeFunction("__fakeReassign", (args: ReassignArgs) =>
    options.reassign ? options.reassign(args) : args.project,
  );
  await page.exposeFunction("__fakeEvaluateAssignment", (request: AssignmentEvaluationRequest) =>
    options.evaluateAssignment
      ? options.evaluateAssignment(request)
      : buildAssignmentMetricReport(request),
  );
  await page.exposeFunction("__fakeCompareExternal", (request: CrossImportComparisonRequest) => {
    if (!options.compareExternal) {
      throw new Error("Unhandled fake external comparison");
    }
    return options.compareExternal(request);
  });

  await page.addInitScript(
    ({
      importedProject,
      importPath,
      exportPath,
      importError,
      exportError,
      reassignError,
      compareExternalError,
    }) => {
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
            return {
              project: importedProject,
              provenance: { kind: "imported", algorithmVersion: 1 },
            };
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
            return {
              project: await (
                window as unknown as { __fakeReassign: (a: unknown) => Promise<unknown> }
              ).__fakeReassign(args),
              provenance: {
                kind: "reassigned",
                strategy: (args as { strategy: string }).strategy,
                mode: (args as { mode: string }).mode,
                maxVoiceCount: (args as { maxVoiceCount: number | null }).maxVoiceCount,
                algorithmVersion: 1,
              },
            };
          }
          if (cmd === "evaluate_assignment") {
            return (
              window as unknown as {
                __fakeEvaluateAssignment: (request: unknown) => Promise<unknown>;
              }
            ).__fakeEvaluateAssignment((args as { request: unknown }).request);
          }
          if (cmd === "compare_external_midi") {
            if (compareExternalError) {
              throw compareExternalError;
            }
            return (
              window as unknown as {
                __fakeCompareExternal: (request: unknown) => Promise<unknown>;
              }
            ).__fakeCompareExternal((args as { request: unknown }).request);
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
      compareExternalError: options.compareExternalError,
    },
  );
}

const COMPONENT_IDS: AssignmentMetricComponent["id"][] = [
  "VOICE_COMPLEXITY",
  "PITCH_MOTION",
  "REGISTER_EXPANSION",
  "SILENCE_GAP",
  "CHANNEL_SWITCH",
  "VOICE_CROSSING",
];

export function buildAssignmentMetricReport(
  request: AssignmentEvaluationRequest,
  overrides: Partial<AssignmentMetricReport> = {},
): AssignmentMetricReport {
  const melodicNotes = request.notes.filter((note) => note.channel !== 9);
  const melodicVoiceCount = new Set(
    melodicNotes.map((note) => note.voiceId).filter((voiceId) => voiceId.trim() !== ""),
  ).size;
  const totalCost = melodicVoiceCount * 12;
  return {
    metric: { id: "ASSIGNMENT_MODEL_COST", version: 1 },
    profile: request.profile,
    melodicNoteCount: melodicNotes.length,
    excludedPercussionNoteCount: request.notes.length - melodicNotes.length,
    melodicVoiceCount,
    components: COMPONENT_IDS.map((id) => ({
      id,
      rawValue: id === "VOICE_COMPLEXITY" ? melodicVoiceCount : 0,
      unit: id === "VOICE_COMPLEXITY" ? "VOICES" : "TRANSITIONS",
      weight: id === "VOICE_COMPLEXITY" ? 12 : 0,
      cost: id === "VOICE_COMPLEXITY" ? totalCost : 0,
    })),
    totalCost,
    hardViolations: [],
    ...overrides,
  };
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
