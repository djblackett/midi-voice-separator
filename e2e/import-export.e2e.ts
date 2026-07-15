import { expect, test } from "@playwright/test";
import { buildFixtureProject, installFakeTauri, note, voice } from "./fixtures/tauriMock";

// Drag-and-drop import is deliberately not covered here: Tauri 2
// intercepts it at the webview level (`getCurrentWebview().onDragDropEvent`,
// not an ordinary HTML5 dragover/drop DOM event), which would need faking
// the full Tauri event-emission protocol for comparatively little extra
// coverage over the button-driven import path below (both end at the same
// `import_midi` command). Native file dialogs are the same kind of
// out-of-scope-for-automation boundary per agents.md's Working Rules.

const twoVoiceProject = buildFixtureProject(
  [note("a", "voice-1", 60, 0), note("b", "voice-2", 64, 240)],
  [voice("voice-1", "Voice 1", 1, 60, 60), voice("voice-2", "Voice 2", 1, 64, 64)],
  { fileName: "song.mid" },
);

test.describe("import", () => {
  test("a successful import shows the file summary and details", async ({ page }) => {
    await installFakeTauri(page, { importedProject: twoVoiceProject });
    await page.goto("/");

    await page.getByRole("button", { name: "Import MIDI" }).click();

    await expect(page.locator(".summary-bar")).toContainText("Loaded song.mid");
    await expect(page.locator(".file-details")).toContainText("single");
    await expect(page.locator(".voice-legend li")).toHaveCount(2);
  });

  test("a failed import shows the error banner and loads no project", async ({ page }) => {
    await installFakeTauri(page, {
      importedProject: twoVoiceProject,
      importError: { code: "IMPORT_FAILED", message: "The file is not a valid MIDI file." },
    });
    await page.goto("/");

    await page.getByRole("button", { name: "Import MIDI" }).click();

    const errorBanner = page.locator(".inline-error");
    await expect(errorBanner).toContainText("IMPORT_FAILED");
    await expect(errorBanner).toContainText("The file is not a valid MIDI file.");
    await expect(page.locator(".voice-legend")).toHaveCount(0);
  });
});

test.describe("export", () => {
  test("a successful export shows the success banner with counts and path", async ({ page }) => {
    await installFakeTauri(page, {
      importedProject: twoVoiceProject,
      exportPath: "C:/fake/song-voices.mid",
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Import MIDI" }).click();
    await page.waitForSelector(".voice-legend");

    await page.getByRole("button", { name: "Export MIDI" }).click();

    const successBanner = page.locator(".export-success");
    await expect(successBanner).toContainText("2 notes");
    await expect(successBanner).toContainText("3 tracks"); // 2 voices + conductor track
    await expect(successBanner).toContainText("C:/fake/song-voices.mid");

    const verification = page.getByLabel("Export round-trip verification");
    await expect(verification).toContainText("Verified application model");
    await expect(verification).toContainText("The written file preserved the modeled MIDI data.");
    await expect(verification).toContainText("Note content: preserved");
    await expect(verification).toContainText("Voice partition: preserved");
    await expect(page.getByLabel("Export readiness summary")).not.toContainText("Round trip");
  });

  test("a failed export shows the error banner", async ({ page }) => {
    await installFakeTauri(page, {
      importedProject: twoVoiceProject,
      exportError: { code: "EXPORT_FAILED", message: "Could not write the file." },
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Import MIDI" }).click();
    await page.waitForSelector(".voice-legend");

    await page.getByRole("button", { name: "Export MIDI" }).click();

    const errorBanner = page.locator(".inline-error");
    await expect(errorBanner).toContainText("EXPORT_FAILED");
    await expect(errorBanner).toContainText("Could not write the file.");
    await expect(page.locator(".export-success")).toHaveCount(0);
  });
});
