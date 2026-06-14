import { useEffect, useState } from "react";
import type { MidiProject } from "../domain/midi/midiProject";
import { formatMidiWarningLocation, formatProjectSummary } from "../domain/midi/midiProject";
import { MidiImportButton } from "../features/midi-import/MidiImportButton";
import { selectAndImportMidi } from "../features/midi-import/importMidi";
import { PianoRoll } from "../features/piano-roll/PianoRoll";
import { getBackendStatus, type AppCommandError } from "../lib/tauri/commands";

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
  const [error, setError] = useState<AppCommandError | null>(null);

  useEffect(() => {
    void getBackendStatus()
      .then((backendStatus) =>
        setStatus(`${backendStatus.application} backend ${backendStatus.status}`),
      )
      .catch((commandError: unknown) => setStatus(getErrorMessage(commandError)));
  }, []);

  async function handleImport() {
    setIsImporting(true);
    setError(null);

    try {
      const importedProject = await selectAndImportMidi();
      if (importedProject) {
        setProject(importedProject);
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

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <h1>Chiptune Voice Separator</h1>
          <p>{status}</p>
        </div>
        <MidiImportButton disabled={isImporting} onImport={() => void handleImport()} />
      </header>

      <section className="summary-bar" aria-live="polite">
        {isImporting ? (
          <span>Importing MIDI...</span>
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

      {project ? (
        <section className="file-details" aria-label="Imported file details">
          <div>
            <span className="detail-label">Format</span>
            <strong>{project.format}</strong>
          </div>
          <div>
            <span className="detail-label">Suggested voices</span>
            <strong>{project.voices.length}</strong>
          </div>
          <div>
            <span className="detail-label">Tempo changes</span>
            <strong>{project.tempoChanges.length}</strong>
          </div>
          <div>
            <span className="detail-label">Time signatures</span>
            <strong>{project.timeSignatures.length}</strong>
          </div>
          <div>
            <span className="detail-label">Recoverable warnings</span>
            <strong>{project.warnings.length}</strong>
          </div>
        </section>
      ) : null}

      {project && project.warnings.length > 0 ? (
        <section className="warnings" aria-label="Import warnings">
          <h2>Recoverable import warnings</h2>
          <p>The MIDI file was imported, but the parser repaired or ignored these events.</p>
          <ul className="warning-list">
            {project.warnings.map((warning, index) => (
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

      {project && project.voices.length > 0 ? (
        <section className="voice-legend" aria-label="Suggested voice assignments">
          <h2>Suggested voices</h2>
          <ul>
            {project.voices.map((voice, index) => (
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

      <section className="editor-grid">
        <PianoRoll project={project} />
      </section>

      <footer className="metrics-bar">{formatProjectSummary(project)}</footer>
    </main>
  );
}
