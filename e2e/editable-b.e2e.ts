import { expect, test, type Page } from "@playwright/test";
import { buildFixtureProject, installFakeTauri, note, voice } from "./fixtures/tauriMock";

// Side B is a live editable branch forked from an immutable snapshot. This
// suite drives the real A/B toggle to prove the two sides edit and undo
// independently and that neither touches the other. Reassignment is driven
// through the voice-swatch selection path (see selection-and-reassignment.e2e).
const project = buildFixtureProject(
  [note("a", "voice-1", 60, 0), note("b", "voice-1", 62, 120), note("c", "voice-2", 64, 240)],
  [voice("voice-1", "Lead", 2, 60, 62), voice("voice-2", "Bass", 1, 64, 64)],
);

async function startCompare(page: Page) {
  await page.getByRole("button", { name: "Import MIDI" }).click();
  await page.waitForSelector(".diff-summary");
  await page.getByRole("button", { name: "Re-run separation" }).click();
  const importValue = await page
    .locator(".diff-target-select option", { hasText: "Import" })
    .getAttribute("value");
  await page.locator(".diff-target-select").selectOption(importValue ?? "");
  await page.getByRole("button", { name: "Start A/B compare" }).click();
}

function voiceRow(page: Page, label: string) {
  return page
    .locator(".voice-legend li")
    .filter({ has: page.getByLabel(`Select notes in ${label}`, { exact: true }) });
}

test("editing side B leaves side A untouched, with independent per-side undo", async ({ page }) => {
  await installFakeTauri(page, {
    importedProject: project,
    // Re-run moves note a from Lead to Bass, so current (A) diverges from the
    // import snapshot that side B is forked from.
    reassign: ({ project: current }) => ({
      ...current,
      notes: current.notes.map((entry) =>
        entry.id === "a" ? { ...entry, voiceId: "voice-2" } : entry,
      ),
    }),
  });
  await page.goto("/");
  await startCompare(page);

  // Side A (active after starting): re-run left Lead with 1 note and Bass with 2.
  await expect(voiceRow(page, "Lead")).toContainText("1 notes");
  await expect(voiceRow(page, "Bass")).toContainText("2 notes");

  // Side B is the forked snapshot: Lead still has 2 notes, Bass 1.
  await page.getByRole("button", { name: "B: Snapshot" }).click();
  await expect(voiceRow(page, "Lead")).toContainText("2 notes");
  await expect(voiceRow(page, "Bass")).toContainText("1 notes");

  // Edit B: move Lead's notes to Bass. B now has Lead 0, Bass 3.
  await page.getByLabel("Select notes in Lead").click();
  await page.keyboard.press("2");
  await expect(voiceRow(page, "Lead")).toContainText("0 notes");
  await expect(voiceRow(page, "Bass")).toContainText("3 notes");

  // Back on A: B's edit did not touch A.
  await page.getByRole("button", { name: "A: Current" }).click();
  await expect(voiceRow(page, "Lead")).toContainText("1 notes");
  await expect(voiceRow(page, "Bass")).toContainText("2 notes");

  // Undo on A reverts only A (undoes the re-run's move, back to the import split).
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(voiceRow(page, "Lead")).toContainText("2 notes");
  await expect(voiceRow(page, "Bass")).toContainText("1 notes");

  // B still holds its own edit -- A's undo left it alone.
  await page.getByRole("button", { name: "B: Snapshot" }).click();
  await expect(voiceRow(page, "Lead")).toContainText("0 notes");
  await expect(voiceRow(page, "Bass")).toContainText("3 notes");
});
