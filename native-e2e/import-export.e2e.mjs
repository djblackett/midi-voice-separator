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
    rmSync(outputPath, { force: true });

    try {
      const exportResult = await browser.execute(
        async (exportPath, exportProject) =>
          window.__TAURI__.core.invoke("export_midi", { path: exportPath, project: exportProject }),
        outputPath,
        project,
      );

      assert.equal(exportResult.noteCount, 2);
      assert.ok(existsSync(outputPath), "export_midi should have written a real file");

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
    } finally {
      rmSync(outputPath, { force: true });
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
