import { useEffect, useMemo, useState } from "react";
import type { MidiProject } from "../domain/midi/midiProject";
import {
  formatMidiChannel,
  formatMidiWarningLocation,
  formatProjectSummary,
  formatSelectedNote,
  formatSelectionSummary,
  formatSeparationSummary,
  formatStrategySuggestion,
} from "../domain/midi/midiProject";
import { MidiImportButton } from "../features/midi-import/MidiImportButton";
import { selectAndImportMidi } from "../features/midi-import/importMidi";
import { listenForMidiFileDrop } from "../features/midi-import/dropImport";
import { MidiExportButton } from "../features/midi-export/MidiExportButton";
import { selectAndExportMidi } from "../features/midi-export/exportMidi";
import { PianoRoll, type InteractionMode } from "../features/piano-roll/PianoRoll";
import {
  getBackendStatus,
  importMidi,
  reassignVoices,
  type AppCommandError,
  type AssignmentMode,
  type ExportMidiResult,
  type SeparationStrategy,
} from "../lib/tauri/commands";
import {
  applyVoiceOverrides,
  voiceIdForNumber,
  type VoiceOverrides,
} from "../domain/midi/voiceAssignments";
import {
  buildVoiceList,
  mergeVoiceOverrides,
  nextVoiceId,
  reconcileVoiceOrderAfterReassign,
  seedVoiceLabelsFromImport,
} from "../domain/midi/voiceManagement";
import { buildFlaggedNoteQueue, findNextFlaggedNoteId } from "../domain/midi/reviewQueue";
import {
  applyRangePatchPreservingHandCorrections,
  buildDefaultPitchMarkers,
  buildDefaultVoiceRangeRules,
  buildVoiceOverridesFromRangeRules,
  clampMidiPitch,
  describePitchRangeRule,
  type PitchMarker,
} from "../domain/midi/rangeRules";
import {
  createEditorHistory,
  pushHistory,
  redoHistory,
  undoHistory,
  type EditorHistoryState,
} from "./editorHistory";
import { buildTempoMap, tickToSeconds } from "../domain/midi/tempoMap";
import { formatPlaybackTime } from "../features/playback/formatPlaybackTime";
import type { Instrument } from "../features/playback/playbackEngine";
import { usePlaybackEngine } from "../features/playback/usePlaybackEngine";

function getErrorMessage(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return "An unexpected error occurred.";
}

function toAppCommandError(commandError: unknown): AppCommandError {
  return typeof commandError === "object" &&
    commandError !== null &&
    "code" in commandError &&
    "message" in commandError &&
    typeof commandError.code === "string" &&
    typeof commandError.message === "string"
    ? { code: commandError.code, message: commandError.message }
    : { code: "UNKNOWN_ERROR", message: getErrorMessage(commandError) };
}

export default function App() {
  const [project, setProject] = useState<MidiProject | null>(null);
  const [status, setStatus] = useState("Checking backend...");
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isReassigning, setIsReassigning] = useState(false);
  const [error, setError] = useState<AppCommandError | null>(null);
  const [exportError, setExportError] = useState<AppCommandError | null>(null);
  const [reassignError, setReassignError] = useState<AppCommandError | null>(null);
  const [exportResult, setExportResult] = useState<ExportMidiResult | null>(null);
  const [selectedNoteIds, setSelectedNoteIds] = useState<ReadonlySet<string>>(new Set());
  const [voiceOverrides, setVoiceOverrides] = useState<VoiceOverrides>({});
  const [voiceOrder, setVoiceOrder] = useState<string[]>([]);
  const [voiceLabels, setVoiceLabels] = useState<Record<string, string>>({});
  const [activeVoiceId, setActiveVoiceId] = useState<string | null>(null);
  const [soloVoiceId, setSoloVoiceId] = useState<string | null>(null);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("select");
  const [pitchMarkers, setPitchMarkers] = useState<PitchMarker[]>([]);
  const [rangeAssignedNoteIds, setRangeAssignedNoteIds] = useState<ReadonlySet<string>>(new Set());
  const [history, setHistory] = useState<EditorHistoryState>(createEditorHistory());
  const [maxVoiceCountInput, setMaxVoiceCountInput] = useState("");
  const [separationStrategy, setSeparationStrategy] = useState<SeparationStrategy>("BALANCED");
  const [assignmentMode, setAssignmentMode] = useState<AssignmentMode>("GREEDY");
  const [isDragOver, setIsDragOver] = useState(false);
  const [instrument, setInstrument] = useState<Instrument>("chiptune");
  const displayedProject = useMemo(() => {
    if (!project) {
      return null;
    }
    const withOverrides = applyVoiceOverrides(project, voiceOverrides);
    return {
      ...withOverrides,
      voices: buildVoiceList(voiceOrder, voiceLabels, withOverrides.notes),
    };
  }, [project, voiceOverrides, voiceOrder, voiceLabels]);
  const selectedNotes = useMemo(
    () => displayedProject?.notes.filter((note) => selectedNoteIds.has(note.id)) ?? [],
    [displayedProject, selectedNoteIds],
  );
  const selectedNote = selectedNotes.length === 1 ? selectedNotes[0] : null;
  const flaggedNotes = useMemo(
    () => buildFlaggedNoteQueue(displayedProject?.notes ?? []),
    [displayedProject],
  );
  const voiceRangeRules = useMemo(
    () => buildDefaultVoiceRangeRules(displayedProject?.voices.map((voice) => voice.id) ?? []),
    [displayedProject],
  );
  const playback = usePlaybackEngine(displayedProject, soloVoiceId, instrument);
  const tempoMap = useMemo(
    () => buildTempoMap(displayedProject?.tempoChanges ?? [], displayedProject?.ppq ?? 480),
    [displayedProject],
  );
  const playbackCurrentSeconds = tickToSeconds(tempoMap, playback.currentTick);
  const playbackDurationSeconds = tickToSeconds(tempoMap, displayedProject?.durationTicks ?? 0);

  useEffect(() => {
    void getBackendStatus()
      .then((backendStatus) =>
        setStatus(`${backendStatus.application} backend ${backendStatus.status}`),
      )
      .catch((commandError: unknown) => setStatus(getErrorMessage(commandError)));
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }

      if (event.key === "Escape") {
        setSelectedNoteIds(new Set());
        return;
      }

      if (event.key === "Tab" && flaggedNotes.length > 0) {
        event.preventDefault();
        const currentStartTick = selectedNote ? selectedNote.startTick : null;
        const nextId = findNextFlaggedNoteId(
          flaggedNotes,
          currentStartTick,
          event.shiftKey ? -1 : 1,
        );
        if (nextId) {
          setSelectedNoteIds(new Set([nextId]));
        }
        return;
      }

      if (!displayedProject || !/^[1-9]$/.test(event.key)) {
        return;
      }

      const targetVoiceId = voiceIdForNumber(displayedProject, Number(event.key));
      if (!targetVoiceId) {
        return;
      }

      event.preventDefault();

      if (interactionMode === "paint") {
        setActiveVoiceId(targetVoiceId);
        return;
      }

      if (selectedNoteIds.size === 0) {
        return;
      }

      pushHistorySnapshot();
      setVoiceOverrides((currentOverrides) => {
        const nextOverrides = { ...currentOverrides };
        for (const noteId of selectedNoteIds) {
          nextOverrides[noteId] = targetVoiceId;
        }
        return nextOverrides;
      });
      setRangeAssignedNoteIds((current) => {
        const next = new Set(current);
        for (const noteId of selectedNoteIds) {
          next.delete(noteId);
        }
        return next;
      });
      setExportResult(null);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    displayedProject,
    selectedNoteIds,
    selectedNote,
    flaggedNotes,
    interactionMode,
    history,
    voiceOverrides,
    voiceOrder,
    voiceLabels,
  ]);

  useEffect(() => {
    // The listener registration is itself async (it's real Tauri IPC), so
    // a cleanup that runs before it resolves (e.g. React StrictMode's
    // double-invoke in development, or this effect's own dependencies
    // changing again quickly) must still unlisten once it does resolve --
    // otherwise the earlier listener leaks and drops end up double-handled.
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    listenForMidiFileDrop({
      onDragActive: setIsDragOver,
      onDrop: (path) => {
        if (isImporting || isExporting || isReassigning) {
          return;
        }
        void handleDroppedPath(path);
      },
    }).then((unlistenFn) => {
      if (cancelled) {
        unlistenFn();
      } else {
        unlisten = unlistenFn;
      }
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [isImporting, isExporting, isReassigning]);

  function applyImportedProject(importedProject: MidiProject) {
    setProject(importedProject);
    setSelectedNoteIds(new Set());
    setVoiceOverrides({});
    setVoiceOrder(importedProject.voices.map((voice) => voice.id));
    setVoiceLabels(seedVoiceLabelsFromImport(importedProject.voices));
    setSeparationStrategy(importedProject.strategySuggestion.strategy);
    setActiveVoiceId(null);
    setSoloVoiceId(null);
    setInteractionMode("select");
    setPitchMarkers(buildDefaultPitchMarkers(importedProject.notes));
    setRangeAssignedNoteIds(new Set());
    setHistory(createEditorHistory());
    setMaxVoiceCountInput("");
    setExportResult(null);
    setExportError(null);
  }

  async function handleImport() {
    setIsImporting(true);
    setError(null);

    try {
      const importedProject = await selectAndImportMidi();
      if (importedProject) {
        applyImportedProject(importedProject);
      }
    } catch (commandError) {
      setError(toAppCommandError(commandError));
    } finally {
      setIsImporting(false);
    }
  }

  async function handleDroppedPath(path: string) {
    setIsImporting(true);
    setError(null);

    try {
      applyImportedProject(await importMidi(path));
    } catch (commandError) {
      setError(toAppCommandError(commandError));
    } finally {
      setIsImporting(false);
    }
  }

  async function handleExport() {
    if (!displayedProject) {
      return;
    }

    setIsExporting(true);
    setExportError(null);
    setExportResult(null);

    try {
      const result = await selectAndExportMidi(displayedProject);
      if (result) {
        setExportResult(result);
      }
    } catch (commandError) {
      setExportError(
        typeof commandError === "object" &&
          commandError !== null &&
          "code" in commandError &&
          "message" in commandError &&
          typeof commandError.code === "string" &&
          typeof commandError.message === "string"
          ? { code: commandError.code, message: commandError.message }
          : { code: "UNKNOWN_ERROR", message: getErrorMessage(commandError) },
      );
    } finally {
      setIsExporting(false);
    }
  }

  async function handleReassign() {
    if (!project) {
      return;
    }

    const parsedMaxVoiceCount = Number.parseInt(maxVoiceCountInput, 10);
    const maxVoiceCount =
      Number.isInteger(parsedMaxVoiceCount) && parsedMaxVoiceCount > 0
        ? parsedMaxVoiceCount
        : undefined;

    setIsReassigning(true);
    setReassignError(null);

    try {
      const reassignedProject = await reassignVoices(
        project,
        voiceOverrides,
        maxVoiceCount,
        separationStrategy,
        assignmentMode,
      );
      pushHistorySnapshot();
      setProject(reassignedProject);
      setVoiceOrder((currentOrder) =>
        reconcileVoiceOrderAfterReassign(
          currentOrder,
          reassignedProject.notes.map((note) => note.voiceId),
        ),
      );
      setExportResult(null);
    } catch (commandError) {
      setReassignError(
        typeof commandError === "object" &&
          commandError !== null &&
          "code" in commandError &&
          "message" in commandError &&
          typeof commandError.code === "string" &&
          typeof commandError.message === "string"
          ? { code: commandError.code, message: commandError.message }
          : { code: "UNKNOWN_ERROR", message: getErrorMessage(commandError) },
      );
    } finally {
      setIsReassigning(false);
    }
  }

  function pushHistorySnapshot() {
    setHistory((currentHistory) =>
      pushHistory(currentHistory, {
        project,
        voiceOverrides,
        voiceOrder,
        voiceLabels,
        rangeAssignedNoteIds,
      }),
    );
  }

  function handleUndo() {
    const result = undoHistory(history, {
      project,
      voiceOverrides,
      voiceOrder,
      voiceLabels,
      rangeAssignedNoteIds,
    });
    if (!result) {
      return;
    }
    setHistory(result.history);
    setProject(result.snapshot.project);
    setVoiceOverrides(result.snapshot.voiceOverrides);
    setVoiceOrder(result.snapshot.voiceOrder);
    setVoiceLabels(result.snapshot.voiceLabels);
    setRangeAssignedNoteIds(result.snapshot.rangeAssignedNoteIds);
    setExportResult(null);
  }

  function handleRedo() {
    const result = redoHistory(history, {
      project,
      voiceOverrides,
      voiceOrder,
      voiceLabels,
      rangeAssignedNoteIds,
    });
    if (!result) {
      return;
    }
    setHistory(result.history);
    setProject(result.snapshot.project);
    setVoiceOverrides(result.snapshot.voiceOverrides);
    setVoiceOrder(result.snapshot.voiceOrder);
    setVoiceLabels(result.snapshot.voiceLabels);
    setRangeAssignedNoteIds(result.snapshot.rangeAssignedNoteIds);
    setExportResult(null);
  }

  function handleCreateVoice() {
    pushHistorySnapshot();
    const newVoiceId = nextVoiceId(voiceOrder);
    setVoiceOrder((currentOrder) => [...currentOrder, newVoiceId]);

    if (selectedNoteIds.size > 0) {
      setVoiceOverrides((currentOverrides) => {
        const nextOverrides = { ...currentOverrides };
        for (const noteId of selectedNoteIds) {
          nextOverrides[noteId] = newVoiceId;
        }
        return nextOverrides;
      });
      setRangeAssignedNoteIds((current) => {
        const next = new Set(current);
        for (const noteId of selectedNoteIds) {
          next.delete(noteId);
        }
        return next;
      });
    }

    setExportResult(null);
  }

  function handleRenameVoice(voiceId: string, label: string) {
    setVoiceLabels((currentLabels) => ({ ...currentLabels, [voiceId]: label }));
  }

  function handleMergeVoice(fromVoiceId: string, toVoiceId: string) {
    if (!displayedProject || fromVoiceId === toVoiceId || toVoiceId === "") {
      return;
    }

    pushHistorySnapshot();
    const patch = mergeVoiceOverrides(displayedProject.notes, fromVoiceId, toVoiceId);
    setVoiceOverrides((currentOverrides) => ({ ...currentOverrides, ...patch }));
    setRangeAssignedNoteIds((current) => {
      const next = new Set(current);
      for (const noteId of Object.keys(patch)) {
        next.delete(noteId);
      }
      return next;
    });
    setVoiceOrder((currentOrder) => currentOrder.filter((voiceId) => voiceId !== fromVoiceId));
    setActiveVoiceId((current) => (current === fromVoiceId ? null : current));
    setSoloVoiceId((current) => (current === fromVoiceId ? null : current));
    setExportResult(null);
  }

  function handleReorderVoice(voiceId: string, direction: -1 | 1) {
    pushHistorySnapshot();
    setVoiceOrder((currentOrder) => {
      const index = currentOrder.indexOf(voiceId);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= currentOrder.length) {
        return currentOrder;
      }
      const nextOrder = [...currentOrder];
      [nextOrder[index], nextOrder[targetIndex]] = [nextOrder[targetIndex], nextOrder[index]];
      return nextOrder;
    });
  }

  function handleToggleSolo(voiceId: string) {
    setSoloVoiceId((current) => (current === voiceId ? null : voiceId));
  }

  function handlePaintNotes(noteIds: string[]) {
    if (!activeVoiceId) {
      return;
    }
    pushHistorySnapshot();
    setVoiceOverrides((currentOverrides) => {
      const nextOverrides = { ...currentOverrides };
      for (const noteId of noteIds) {
        nextOverrides[noteId] = activeVoiceId;
      }
      return nextOverrides;
    });
    setRangeAssignedNoteIds((current) => {
      const next = new Set(current);
      for (const noteId of noteIds) {
        next.delete(noteId);
      }
      return next;
    });
    setExportResult(null);
  }

  function handleMarkerPitchChange(markerId: string, pitch: number) {
    if (!Number.isFinite(pitch)) {
      return;
    }

    setPitchMarkers((currentMarkers) =>
      currentMarkers.map((marker) =>
        marker.id === markerId ? { ...marker, pitch: clampMidiPitch(pitch) } : marker,
      ),
    );
  }

  function handleApplyPitchRanges() {
    if (!displayedProject || voiceRangeRules.length === 0) {
      return;
    }

    const rangePatch = buildVoiceOverridesFromRangeRules(
      displayedProject.notes,
      pitchMarkers,
      voiceRangeRules,
    );
    if (Object.keys(rangePatch).length === 0) {
      return;
    }

    const { overrides, rangeAssignedNoteIds: nextRangeAssignedNoteIds } =
      applyRangePatchPreservingHandCorrections(voiceOverrides, rangeAssignedNoteIds, rangePatch);

    pushHistorySnapshot();
    setVoiceOverrides(overrides);
    setRangeAssignedNoteIds(nextRangeAssignedNoteIds);
    setSelectedNoteIds(new Set(Object.keys(rangePatch)));
    setExportResult(null);
  }

  function handleTogglePaintMode() {
    setInteractionMode((mode) => (mode === "paint" ? "select" : "paint"));
  }

  function handleToggleRangeMode() {
    setInteractionMode((mode) => (mode === "range" ? "select" : "range"));
  }

  function handleReviewStep(direction: 1 | -1) {
    const currentStartTick = selectedNote ? selectedNote.startTick : null;
    const nextId = findNextFlaggedNoteId(flaggedNotes, currentStartTick, direction);
    if (nextId) {
      setSelectedNoteIds(new Set([nextId]));
    }
  }

  function handleSelectVoiceSwatch(voiceId: string) {
    setActiveVoiceId((current) => (current === voiceId ? null : voiceId));
    if (!displayedProject) {
      return;
    }
    const voiceNoteIds = displayedProject.notes
      .filter((note) => note.voiceId === voiceId)
      .map((note) => note.id);
    setSelectedNoteIds(new Set(voiceNoteIds));
  }

  return (
    <main className="app-shell">
      {isDragOver ? (
        <div className="drop-overlay" role="status" aria-live="polite">
          <p>Drop to import MIDI file</p>
        </div>
      ) : null}
      <header className="app-header">
        <div>
          <h1>Chiptune Voice Separator</h1>
          <p>{status}</p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={handleUndo}
            disabled={history.past.length === 0 || isReassigning}
          >
            Undo
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={handleRedo}
            disabled={history.future.length === 0 || isReassigning}
          >
            Redo
          </button>
          <MidiImportButton
            disabled={isImporting || isExporting || isReassigning}
            onImport={() => void handleImport()}
          />
          <MidiExportButton
            disabled={!displayedProject || isImporting || isExporting || isReassigning}
            onExport={() => void handleExport()}
          />
        </div>
      </header>

      <section className="summary-bar" aria-live="polite">
        {isImporting ? (
          <span>Importing MIDI...</span>
        ) : isExporting ? (
          <span>Exporting corrected MIDI...</span>
        ) : project ? (
          <span>Loaded {project.fileName}</span>
        ) : (
          <span>Select a Standard MIDI File to inspect its notes.</span>
        )}
      </section>

      {error ? (
        <section className="inline-error" role="alert">
          <strong>{error.code}</strong>
          <span>{error.message}</span>
        </section>
      ) : null}

      {exportError ? (
        <section className="inline-error" role="alert">
          <strong>{exportError.code}</strong>
          <span>{exportError.message}</span>
        </section>
      ) : null}

      {reassignError ? (
        <section className="inline-error" role="alert">
          <strong>{reassignError.code}</strong>
          <span>{reassignError.message}</span>
        </section>
      ) : null}

      {exportResult ? (
        <section className="export-success" aria-live="polite">
          Exported {exportResult.noteCount} notes across {exportResult.trackCount} tracks to{" "}
          {exportResult.path}.
        </section>
      ) : null}

      {displayedProject ? (
        <section className="separation-summary" aria-live="polite">
          <span>
            {isReassigning
              ? "Re-running separation..."
              : formatSeparationSummary(
                  displayedProject.separationSummary,
                  displayedProject.notes.length,
                )}
          </span>
          <div className="separation-summary-actions">
            {flaggedNotes.length > 0 ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => handleReviewStep(1)}
                disabled={isReassigning}
              >
                Review flagged notes ({flaggedNotes.length})
              </button>
            ) : null}
            <label className="max-voice-count-label">
              Max voices
              <input
                type="number"
                className="max-voice-count-input"
                min={1}
                placeholder="auto"
                value={maxVoiceCountInput}
                onChange={(event) => setMaxVoiceCountInput(event.target.value)}
                aria-label="Maximum voice count for re-run separation"
              />
            </label>
            <label className="separation-strategy-label">
              Strategy
              <select
                className="separation-strategy-select"
                value={separationStrategy}
                onChange={(event) =>
                  setSeparationStrategy(event.target.value as SeparationStrategy)
                }
                aria-label="Separation strategy for re-run separation"
              >
                <option value="BALANCED">Balanced</option>
                <option value="CHANNEL_PRIORITY">Channel priority</option>
                <option value="REGISTER_PRIORITY">Register priority</option>
                <option value="STRICT_CHANNEL">Strict channel</option>
              </select>
            </label>
            <label className="assignment-mode-label">
              Search
              <select
                className="assignment-mode-select"
                value={assignmentMode}
                onChange={(event) => setAssignmentMode(event.target.value as AssignmentMode)}
                aria-label="Assignment search mode for re-run separation"
              >
                <option value="GREEDY">Greedy (fast)</option>
                <option value="GLOBAL">Global (lookahead)</option>
                <option value="CONTIG">Contig (structure)</option>
              </select>
            </label>
            <button
              type="button"
              className="secondary-button"
              onClick={() => void handleReassign()}
              disabled={isImporting || isExporting || isReassigning}
            >
              Re-run separation
            </button>
          </div>
          <p className="strategy-suggestion">
            {formatStrategySuggestion(displayedProject.strategySuggestion)}
          </p>
        </section>
      ) : null}

      {displayedProject ? (
        <section className="file-details" aria-label="Imported file details">
          <div>
            <span className="detail-label">Format</span>
            <strong>{displayedProject.format}</strong>
          </div>
          <div>
            <span className="detail-label">Suggested voices</span>
            <strong>{displayedProject.voices.length}</strong>
          </div>
          <div>
            <span className="detail-label">Tempo changes</span>
            <strong>{displayedProject.tempoChanges.length}</strong>
          </div>
          <div>
            <span className="detail-label">Time signatures</span>
            <strong>{displayedProject.timeSignatures.length}</strong>
          </div>
          <div>
            <span className="detail-label">Recoverable warnings</span>
            <strong>{displayedProject.warnings.length}</strong>
          </div>
        </section>
      ) : null}

      {displayedProject && displayedProject.warnings.length > 0 ? (
        <section className="warnings" aria-label="Import warnings">
          <details>
            <summary>Recoverable import warnings ({displayedProject.warnings.length})</summary>
            <p>The MIDI file was imported, but the parser repaired or ignored these events.</p>
            <ul className="warning-list">
              {displayedProject.warnings.map((warning, index) => (
                <li
                  key={`${warning.code}-${warning.trackIndex ?? "none"}-${warning.tick ?? "none"}-${index}`}
                >
                  <div className="warning-heading">
                    <span>{warning.code}</span>
                    <span>{formatMidiWarningLocation(warning)}</span>
                  </div>
                  <p>{warning.message}</p>
                </li>
              ))}
            </ul>
          </details>
        </section>
      ) : null}

      {displayedProject ? (
        <section className="voice-legend" aria-label="Voice assignments">
          <h2>Voices</h2>
          <ul>
            {displayedProject.voices.map((voice, index) => (
              <li key={voice.id} className={activeVoiceId === voice.id ? "active" : undefined}>
                <button
                  type="button"
                  className="voice-swatch"
                  style={{ backgroundColor: `var(--voice-${(index % 12) + 1})` }}
                  aria-label={`Select notes in ${voice.label}`}
                  onClick={() => handleSelectVoiceSwatch(voice.id)}
                />
                <input
                  className="voice-name-input"
                  value={voice.label}
                  onFocus={pushHistorySnapshot}
                  onChange={(event) => handleRenameVoice(voice.id, event.target.value)}
                  aria-label={`Rename ${voice.label}`}
                />
                <span>
                  {voice.noteCount} notes, pitches {voice.lowestPitch}-{voice.highestPitch}
                </span>
                <button
                  type="button"
                  className={soloVoiceId === voice.id ? "voice-solo active" : "voice-solo"}
                  onClick={() => handleToggleSolo(voice.id)}
                  aria-pressed={soloVoiceId === voice.id ? "true" : "false"}
                >
                  Solo
                </button>
                <button
                  type="button"
                  className="voice-reorder"
                  onClick={() => handleReorderVoice(voice.id, -1)}
                  disabled={index === 0}
                  aria-label={`Move ${voice.label} up`}
                >
                  ▲
                </button>
                <button
                  type="button"
                  className="voice-reorder"
                  onClick={() => handleReorderVoice(voice.id, 1)}
                  disabled={index === displayedProject.voices.length - 1}
                  aria-label={`Move ${voice.label} down`}
                >
                  ▼
                </button>
                <select
                  className="voice-merge-select"
                  value=""
                  onChange={(event) => handleMergeVoice(voice.id, event.target.value)}
                  aria-label={`Merge ${voice.label} into another voice`}
                >
                  <option value="">Merge into...</option>
                  {displayedProject.voices
                    .filter((otherVoice) => otherVoice.id !== voice.id)
                    .map((otherVoice) => (
                      <option key={otherVoice.id} value={otherVoice.id}>
                        {otherVoice.label}
                      </option>
                    ))}
                </select>
              </li>
            ))}
          </ul>
          <button type="button" className="secondary-button" onClick={handleCreateVoice}>
            + New voice
          </button>
        </section>
      ) : null}

      {displayedProject ? (
        <section className="range-rules" aria-label="Pitch range voice rules">
          <div className="range-rules-header">
            <h2>Pitch ranges</h2>
            <button
              type="button"
              className="secondary-button"
              onClick={handleApplyPitchRanges}
              disabled={voiceRangeRules.length === 0}
            >
              Apply ranges
            </button>
          </div>
          <div className="pitch-marker-list">
            {pitchMarkers.map((marker) => (
              <label key={marker.id} className="pitch-marker-control">
                {marker.label}
                <input
                  type="number"
                  min={0}
                  max={127}
                  value={marker.pitch}
                  onChange={(event) =>
                    handleMarkerPitchChange(marker.id, Number.parseInt(event.target.value, 10))
                  }
                />
              </label>
            ))}
          </div>
          {voiceRangeRules.length > 0 ? (
            <ul className="range-rule-list">
              {voiceRangeRules.map((rule) => {
                const voiceLabel =
                  displayedProject.voices.find((voice) => voice.id === rule.voiceId)?.label ??
                  rule.voiceId;
                return (
                  <li key={rule.id}>
                    <span>{rule.label}</span>
                    <strong>{voiceLabel}</strong>
                    <span>{describePitchRangeRule(rule, pitchMarkers)}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="range-rules-empty">Create at least one voice before applying ranges.</p>
          )}
        </section>
      ) : null}

      {displayedProject ? (
        <section className="selection-details" aria-label="Selected note details">
          <h2>Selected note{selectedNotes.length === 1 ? "" : "s"}</h2>
          {selectedNote ? (
            <dl>
              <div>
                <dt>Pitch</dt>
                <dd>{selectedNote.pitch}</dd>
              </div>
              <div>
                <dt>Voice</dt>
                <dd>{selectedNote.voiceId}</dd>
              </div>
              <div>
                <dt>Channel</dt>
                <dd>{formatMidiChannel(selectedNote.channel)}</dd>
              </div>
              <div>
                <dt>Ticks</dt>
                <dd>
                  {selectedNote.startTick}-{selectedNote.endTick}
                </dd>
              </div>
            </dl>
          ) : selectedNotes.length > 1 ? (
            <p>{formatSelectionSummary(selectedNotes)}</p>
          ) : (
            <p>{formatSelectedNote(null)}</p>
          )}
          <p className="keyboard-hint">
            Click a note, shift-click to add or remove one, or drag a marquee over many. Press{" "}
            <kbd>1</kbd>-<kbd>9</kbd> to assign the selection to an existing voice. Press{" "}
            <kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd> to step through flagged notes. Press{" "}
            <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> to undo or
            redo a correction. Press <kbd>Esc</kbd> to clear selection. On the piano roll,{" "}
            <kbd>Ctrl</kbd>+wheel zooms horizontally and <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+wheel
            zooms vertically (both anchored at the cursor); plain wheel pans horizontally and{" "}
            <kbd>Shift</kbd>+wheel pans vertically.
          </p>
        </section>
      ) : null}

      {displayedProject ? (
        <section className="piano-roll-toolbar">
          <button
            type="button"
            className="secondary-button"
            onClick={playback.isPlaying ? playback.pause : playback.play}
            disabled={isImporting || isExporting || isReassigning}
          >
            {playback.isPlaying ? "Pause" : "Play"}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={playback.stop}
            disabled={isImporting || isExporting || isReassigning}
          >
            Stop
          </button>
          <label className="instrument-label">
            Sound
            <select
              className="instrument-select"
              value={instrument}
              onChange={(event) => setInstrument(event.target.value as Instrument)}
              aria-label="Playback instrument"
            >
              <option value="chiptune">Chiptune</option>
              <option value="piano">Piano</option>
            </select>
          </label>
          <span className="playback-time">
            {formatPlaybackTime(playbackCurrentSeconds)} /{" "}
            {formatPlaybackTime(playbackDurationSeconds)}
          </span>
          <button
            type="button"
            className={interactionMode === "paint" ? "secondary-button active" : "secondary-button"}
            onClick={handleTogglePaintMode}
            aria-pressed={interactionMode === "paint" ? "true" : "false"}
          >
            {interactionMode === "paint" ? "Paint mode: on" : "Paint mode: off"}
          </button>
          <button
            type="button"
            className={interactionMode === "range" ? "secondary-button active" : "secondary-button"}
            onClick={handleToggleRangeMode}
            aria-pressed={interactionMode === "range" ? "true" : "false"}
          >
            {interactionMode === "range" ? "Range markers: on" : "Range markers: off"}
          </button>
          {interactionMode === "paint" ? (
            <span className="piano-roll-toolbar-hint">
              {activeVoiceId
                ? `Click or drag to paint notes into ${
                    displayedProject.voices.find((voice) => voice.id === activeVoiceId)?.label ??
                    activeVoiceId
                  }.`
                : "Click a voice swatch above to choose what to paint."}
            </span>
          ) : interactionMode === "range" ? (
            <span className="piano-roll-toolbar-hint">
              Drag marker handles in the left piano-roll gutter, then apply the pitch ranges.
            </span>
          ) : null}
        </section>
      ) : null}

      <section className="editor-grid">
        <PianoRoll
          project={displayedProject}
          selectedNoteIds={selectedNoteIds}
          onSelectionChange={setSelectedNoteIds}
          soloVoiceId={soloVoiceId}
          interactionMode={interactionMode}
          activeVoiceId={activeVoiceId}
          onPaintNotes={handlePaintNotes}
          pitchMarkers={pitchMarkers}
          onPitchMarkersChange={setPitchMarkers}
          currentPlaybackTick={playback.currentTick}
          isPlaying={playback.isPlaying}
          onSeek={playback.seek}
        />
      </section>

      <footer className="metrics-bar">{formatProjectSummary(displayedProject)}</footer>
    </main>
  );
}
