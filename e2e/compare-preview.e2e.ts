import { expect, test, type Page } from "@playwright/test";
import { buildFixtureProject, installFakeTauri, note, voice } from "./fixtures/tauriMock";

const project = buildFixtureProject(
  [note("a", "voice-1", 60, 0), note("b", "voice-2", 67, 480)],
  [voice("voice-1", "Lead", 1, 60, 60), voice("voice-2", "Bass", 1, 67, 67)],
);

async function importAndCompare(page: Page) {
  await page.getByRole("button", { name: "Import MIDI" }).click();
  await page.waitForSelector(".diff-summary");
  await page.getByRole("button", { name: "Re-run separation" }).click();
  const importValue = await page
    .locator(".diff-target-select option", { hasText: "Import" })
    .getAttribute("value");
  await page.locator(".diff-target-select").selectOption(importValue ?? "");
  await page.getByRole("button", { name: "Start A/B compare" }).click();
}

test("the diff view is read-only while side B stays editable, and exiting restores side A", async ({
  page,
}) => {
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
  await importAndCompare(page);

  // Side B is now a live editable branch, not a frozen read-only preview.
  await page.getByRole("button", { name: "B: Snapshot" }).click();
  await expect(page.getByText("Read-only preview: editing is disabled")).toBeHidden();
  await expect(page.getByRole("button", { name: "Paint mode: off" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Re-run separation" })).toBeEnabled();

  // The diff view is the only read-only comparison view.
  await page.getByRole("button", { name: "Diff" }).click();
  await expect(page.getByText("Read-only preview: editing is disabled")).toBeVisible();
  await expect(page.getByRole("button", { name: "Paint mode: off" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Re-run separation" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeDisabled();

  await page.getByRole("button", { name: "Exit compare" }).click();
  await expect(page.getByText("Read-only preview: editing is disabled")).toBeHidden();
  await expect(page.getByRole("button", { name: "Paint mode: off" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Re-run separation" })).toBeEnabled();
});
