import { expect, test, type Page } from "@playwright/test";
import { buildFixtureProject, installFakeTauri, note, voice } from "./fixtures/tauriMock";

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

test("split view shows both sides and clicking a pane sets the active side", async ({ page }) => {
  await installFakeTauri(page, {
    importedProject: project,
    reassign: ({ project: current }) => ({
      ...current,
      notes: current.notes.map((entry) =>
        entry.id === "a" ? { ...entry, voiceId: "voice-2" } : entry,
      ),
    }),
  });
  await page.goto("/");
  await startCompare(page);

  await page.getByRole("button", { name: "Split view" }).click();

  // Both sides render as side-qualified panes.
  await expect(page.locator(".editor-pane")).toHaveCount(2);
  await expect(page.getByRole("group", { name: /Side A piano roll/ })).toBeVisible();
  await expect(page.getByRole("group", { name: /Side B piano roll/ })).toBeVisible();

  // Side A is the active (editable) side by default.
  await expect(page.locator(".editor-pane-active")).toContainText("Side A");

  // Clicking the Side B pane makes B the active side.
  await page.getByRole("group", { name: /Side B piano roll/ }).click();
  await expect(page.locator(".editor-pane-active")).toContainText("Side B");
  await expect(page.getByRole("button", { name: "B: Draft" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // Returning to single view collapses the split.
  await page.getByRole("button", { name: "Single view" }).click();
  await expect(page.locator(".editor-split")).toHaveCount(0);
});
