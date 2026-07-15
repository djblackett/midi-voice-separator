import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixturePath = path.join(root, "fixtures", "two-note-smoke.mid");

describe("native Tauri IPC bridge", () => {
  // The Playwright suite fakes `invoke()` entirely, and `cargo test` calls the
  // command functions directly without going through Tauri's IPC layer at
  // all. This is the only automated coverage of the real bridge: a real
  // renderer calling `window.__TAURI__.core.invoke`, into the real compiled
  // Rust commands, reading and writing a real file on disk.
  it("imports a real fixture and exports it back out through the real Rust commands", async () => {
    await browser.waitUntil(
      async () => (await browser.execute(() => document.title)) === "Chiptune Voice Separator",
      { timeout: 30_000, interval: 500, timeoutMsg: "The native window never finished loading." },
    );

    const imported = await browser.execute(
      async (importPath) => window.__TAURI__.core.invoke("import_midi", { path: importPath }),
      fixturePath,
    );
    const { project } = imported;

    assert.equal(project.notes.length, 2, "the fixture has exactly two notes");
    assert.equal(project.notes[0].pitch, 60); // C4
    assert.equal(project.notes[1].pitch, 64); // E4
    assert.deepEqual(imported.provenance, { kind: "imported", algorithmVersion: 1 });

    const reassigned = await browser.execute(
      async (inputProject) =>
        window.__TAURI__.core.invoke("reassign_voices", {
          project: inputProject,
          locked: {},
          maxVoiceCount: 4,
          strategy: "REGISTER_PRIORITY",
          mode: "GLOBAL",
        }),
      project,
    );
    assert.deepEqual(reassigned.provenance, {
      kind: "reassigned",
      strategy: "REGISTER_PRIORITY",
      mode: "GLOBAL",
      maxVoiceCount: 4,
      algorithmVersion: 1,
    });

    const outputPath = path.join(os.tmpdir(), "chiptune-voice-separator-native-e2e-export.mid");
    const unrelatedPath = path.join(
      os.tmpdir(),
      "chiptune-voice-separator-native-e2e-unrelated.mid",
    );
    rmSync(outputPath, { force: true });
    rmSync(unrelatedPath, { force: true });

    try {
      const exportResult = await browser.execute(
        async (exportPath, exportProject) =>
          window.__TAURI__.core.invoke("export_midi", { path: exportPath, project: exportProject }),
        outputPath,
        project,
      );

      assert.equal(exportResult.noteCount, 2);
      assert.ok(existsSync(outputPath), "export_midi should have written a real file");
      assert.equal(exportResult.verification.status, "VERIFIED");
      assert.equal(exportResult.verification.policy, "STRICT_ROUND_TRIP_V1");
      assert.equal(exportResult.verification.noteSummary.contentPreserved, true);

      const reimported = await browser.execute(
        async (importPath) => window.__TAURI__.core.invoke("import_midi", { path: importPath }),
        outputPath,
      );

      assert.equal(
        reimported.project.notes.length,
        2,
        "the exported file should re-import cleanly",
      );
      assert.deepEqual(reimported.provenance, { kind: "appExportedVoiceTracks" });

      const comparison = await browser.execute(
        async (request) => window.__TAURI__.core.invoke("compare_external_midi", { request }),
        {
          referencePath: outputPath,
          referenceDocumentId: "native-export-reference",
          editable: { documentId: "native-current", project },
        },
      );
      assert.equal(comparison.reference.documentId, "native-export-reference");
      assert.equal(comparison.correspondence.comparable, true);
      assert.equal(comparison.correspondence.policy, "CROSS_IMPORT_V1");

      const unrelatedProject = {
        ...project,
        notes: project.notes.map((note) => ({ ...note, pitch: note.pitch + 24 })),
        voices: project.voices.map((voice) => ({
          ...voice,
          lowestPitch: voice.lowestPitch + 24,
          highestPitch: voice.highestPitch + 24,
        })),
      };
      await browser.execute(
        async (exportPath, exportProject) =>
          window.__TAURI__.core.invoke("export_midi", { path: exportPath, project: exportProject }),
        unrelatedPath,
        unrelatedProject,
      );
      const unrelatedComparison = await browser.execute(
        async (request) => window.__TAURI__.core.invoke("compare_external_midi", { request }),
        {
          referencePath: unrelatedPath,
          referenceDocumentId: "native-unrelated-reference",
          editable: { documentId: "native-current", project },
        },
      );
      assert.equal(unrelatedComparison.correspondence.comparable, false);
      assert.equal(unrelatedComparison.correspondence.incomparableReason, "INSUFFICIENT_COVERAGE");
    } finally {
      rmSync(outputPath, { force: true });
      rmSync(unrelatedPath, { force: true });
    }
  });

  it("reports a structured error for a real invoke failure, not just a shell success", async () => {
    const commandError = await browser.execute(async () => {
      try {
        await window.__TAURI__.core.invoke("import_midi", { path: "" });
        return null;
      } catch (error) {
        // Catch inside the webview so WebDriver serializes the Rust rejection
        // object instead of flattening it to the string "[object Object]".
        return error;
      }
    });

    assert.deepEqual(commandError, {
      code: "EMPTY_PATH",
      message: "Select a MIDI file before importing.",
    });
  });
});
