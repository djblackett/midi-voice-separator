import { useEffect, useMemo, useState } from "react";
import type { MidiProject } from "../domain/midi/midiProject";
import {
  formatMidiChannel,
  formatMidiWarningLocation,
  formatProjectSummary,
  formatSelectedNote,
} from "../domain/midi/midiProject";
import { MidiImportButton } from "../features/midi-import/MidiImportButton";
import { selectAndImportMidi } from "../features/midi-import/importMidi";
import { MidiExportButton } from "../features/midi-export/MidiExportButton";
import { selectAndExportMidi } from "../features/midi-export/exportMidi";
import { PianoRoll } from "../features/piano-roll/PianoRoll";
import {
  getBackendStatus,
  type AppCommandError,
  type ExportMidiResult,
} from "../lib/tauri/commands";
import {
  applyVoiceOverrides,
  voiceIdForNumber,
  type VoiceOverrides,
} from "../domain/midi/voiceAssignments";

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

export default function App() {
  const [project, setProject] = useState<MidiProject | null>(null);
  const [status, setStatus] = useState("Checking backend...");
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<AppCommandError | null>(null);
  const [exportError, setExportError] = useState<AppCommandError | null>(null);
  const [exportResult, setExportResult] = useState<ExportMidiResult | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [voiceOverrides, setVoiceOverrides] = useState<VoiceOverrides>({});
  const displayedProject = useMemo(
    () => (project ? applyVoiceOverrides(project, voiceOverrides) : null),
    [project, voiceOverrides],
  );
  const selectedNote = displayedProject?.notes.find((note) => note.id === selectedNoteId) ?? null;

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

      if (event.key === "Escape") {
        setSelectedNoteId(null);
        return;
      }

      if (!selectedNoteId || !displayedProject || !/^[1-9]$/.test(event.key)) {
        return;
      }

      const targetVoiceId = voiceIdForNumber(displayedProject, Number(event.key));
      if (!targetVoiceId) {
        return;
      }

      event.preventDefault();
      setVoiceOverrides((currentOverrides) => ({
        ...currentOverrides,
        [selectedNoteId]: targetVoiceId,
      }));
      setExportResult(null);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [displayedProject, selectedNoteId]);

  async function handleImport() {
    setIsImporting(true);
    setError(null);

    try {
      const importedProject = await selectAndImportMidi();
      if (importedProject) {
        setProject(importedProject);
        setSelectedNoteId(null);
        setVoiceOverrides({});
        setExportResult(null);
        setExportError(null);
      }
    } catch (commandError) {
      setError(
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

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <h1>Chiptune Voice Separator</h1>
          <p>{status}</p>
        </div>
        <div className="header-actions">
          <MidiImportButton
            disabled={isImporting || isExporting}
            onImport={() => void handleImport()}
          />
          <MidiExportButton
            disabled={!displayedProject || isImporting || isExporting}
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

      {exportResult ? (
        <section className="export-success" aria-live="polite">
          Exported {exportResult.noteCount} notes across {exportResult.trackCount} tracks to{" "}
          {exportResult.path}.
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
          <h2>Recoverable import warnings</h2>
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
        </section>
      ) : null}

      {displayedProject && displayedProject.voices.length > 0 ? (
        <section className="voice-legend" aria-label="Suggested voice assignments">
          <h2>Suggested voices</h2>
          <ul>
            {displayedProject.voices.map((voice, index) => (
              <li key={voice.id}>
                <span
                  className="voice-swatch"
                  style={{ backgroundColor: `var(--voice-${(index % 6) + 1})` }}
                />
                <span>{voice.label}</span>
                <span>
                  {voice.noteCount} notes, pitches {voice.lowestPitch}-{voice.highestPitch}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {displayedProject ? (
        <section className="selection-details" aria-label="Selected note details">
          <h2>Selected note</h2>
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
          ) : (
            <p>{formatSelectedNote(null)}</p>
          )}
          <p className="keyboard-hint">
            Select a note, then press <kbd>1</kbd>-<kbd>9</kbd> to assign it to an existing voice.
            Press <kbd>Esc</kbd> to clear selection.
          </p>
        </section>
      ) : null}

      <section className="editor-grid">
        <PianoRoll
          project={displayedProject}
          selectedNoteId={selectedNoteId}
          onSelectedNoteChange={setSelectedNoteId}
        />
      </section>

      <footer className="metrics-bar">{formatProjectSummary(displayedProject)}</footer>
    </main>
  );
}
