import { expect, test, type Page } from "@playwright/test";
import { buildFixtureProject, installFakeTauri, note, voice } from "./fixtures/tauriMock";

const twoVoiceProject = buildFixtureProject(
  [
    note("a", "voice-1", 60, 0),
    note("b", "voice-1", 62, 120),
    note("c", "voice-2", 64, 240),
    note("d", "voice-2", 66, 360),
  ],
  [voice("voice-1", "Voice 1", 2, 60, 62), voice("voice-2", "Voice 2", 2, 64, 66)],
);

async function importFixture(page: Page) {
  await page.getByRole("button", { name: "Import MIDI" }).click();
  await page.waitForSelector(".editor-snapshots", { timeout: 5000 });
}

test.describe("editor snapshots", () => {
  test("import creates a single Import snapshot", async ({ page }) => {
    await installFakeTauri(page, { importedProject: twoVoiceProject });
    await page.goto("/");
    await importFixture(page);

    const rows = page.locator(".snapshot-list li");
    await expect(rows).toHaveCount(1);
    await expect(rows.first().locator(".snapshot-meta span")).toContainText("Import");
  });

  test("manual save, rename, and delete a snapshot", async ({ page }) => {
    await installFakeTauri(page, { importedProject: twoVoiceProject });
    await page.goto("/");
    await importFixture(page);

    await page.locator(".editor-snapshots-save .snapshot-name-input").fill("My checkpoint");
    await page.getByRole("button", { name: "Save snapshot" }).click();
    await expect(page.locator(".snapshot-list li")).toHaveCount(2);

    const manualRow = page
      .locator(".snapshot-list li")
      .filter({ has: page.locator('input.snapshot-name-input[value="My checkpoint"]') });
    await expect(manualRow).toHaveCount(1);

    await manualRow.locator(".snapshot-name-input").fill("Renamed checkpoint");
    await expect(
      page.locator('.snapshot-list li input.snapshot-name-input[value="Renamed checkpoint"]'),
    ).toHaveCount(1);

    // Re-locate: manualRow's filter still targets the pre-rename value, so
    // it no longer matches anything after the rename above.
    const renamedRow = page
      .locator(".snapshot-list li")
      .filter({ has: page.locator('input.snapshot-name-input[value="Renamed checkpoint"]') });
    await renamedRow.getByRole("button", { name: "Delete" }).click();
    await expect(page.locator(".snapshot-list li")).toHaveCount(1);
  });

  test("re-run separation records Before rerun and After rerun snapshots", async ({ page }) => {
    await installFakeTauri(page, {
      importedProject: twoVoiceProject,
      reassign: ({ project }) => ({
        ...project,
        notes: project.notes.map((n) => (n.id === "a" ? { ...n, voiceId: "voice-2" } : n)),
      }),
    });
    await page.goto("/");
    await importFixture(page);

    await page.getByRole("button", { name: "Re-run separation" }).click();
    await expect(page.locator(".snapshot-list li")).toHaveCount(3);

    const sources = await page.locator(".snapshot-list li .snapshot-meta span").allInnerTexts();
    // Newest first: after-rerun, before-rerun, import.
    expect(sources[0]).toContain("After rerun");
    expect(sources[1]).toContain("Before rerun");
    expect(sources[2]).toContain("Import");
  });

  test("restoring a snapshot taken before a re-run reverts the voice structure, and undoing the restore reverts back", async ({
    page,
  }) => {
    await installFakeTauri(page, {
      importedProject: twoVoiceProject,
      // The re-run collapses voice-1's notes into voice-2, so afterward
      // only one voice has notes and reconcileVoiceOrderAfterReassign
      // drops the now-empty voice-1 from the legend.
      reassign: ({ project }) => ({
        ...project,
        notes: project.notes.map((n) =>
          n.id === "a" || n.id === "b" ? { ...n, voiceId: "voice-2" } : n,
        ),
        separationSummary: { meanConfidence: 0.7, lowConfidenceNoteCount: 1, voiceCount: 2 },
      }),
    });
    await page.goto("/");
    await importFixture(page);

    await page.getByRole("button", { name: "Re-run separation" }).click();
    await expect(page.locator(".voice-legend li")).toHaveCount(1);

    const importOptionValue = await page
      .locator(".snapshot-list li", { hasText: "Import" })
      .getByRole("button", { name: "Restore" });
    await importOptionValue.click();

    // Restoring "Import" brings back the original two-voice structure.
    await expect(page.locator(".voice-legend li")).toHaveCount(2);

    await page.getByRole("button", { name: "Undo" }).click();

    // Undoing the restore returns to the post-rerun, single-voice state --
    // proving restore pushed onto the undo stack as a normal action (C4).
    await expect(page.locator(".voice-legend li")).toHaveCount(1);
  });

  test("Use these settings applies a snapshot's re-run settings without restoring state", async ({
    page,
  }) => {
    await installFakeTauri(page, { importedProject: twoVoiceProject });
    await page.goto("/");
    await importFixture(page);

    await page.locator(".separation-strategy-select").selectOption("CHANNEL_PRIORITY");
    await page.locator(".editor-snapshots-save .snapshot-name-input").fill("Channel checkpoint");
    await page.getByRole("button", { name: "Save snapshot" }).click();

    // Switch back to Balanced, then confirm "Use these settings" restores
    // Channel priority on the selector without touching voice assignments.
    await page.locator(".separation-strategy-select").selectOption("BALANCED");
    const manualRow = page
      .locator(".snapshot-list li")
      .filter({ has: page.locator('input.snapshot-name-input[value="Channel checkpoint"]') });
    await manualRow.getByRole("button", { name: "Use these settings" }).click();

    await expect(page.locator(".separation-strategy-select")).toHaveValue("CHANNEL_PRIORITY");
    await expect(page.locator(".voice-legend li")).toHaveCount(2);
  });
});
