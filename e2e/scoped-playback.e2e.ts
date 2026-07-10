import { expect, test } from "@playwright/test";
import { buildFixtureProject, installFakeTauri, note, voice } from "./fixtures/tauriMock";

const project = buildFixtureProject(
  [note("a", "voice-1", 60, 0), note("b", "voice-1", 64, 960)],
  [voice("voice-1", "Lead", 2, 60, 64), voice("voice-2", "Bass", 0, 36, 48)],
  { durationTicks: 1920 },
);

test("changed-notes playback scope activates only for a comparable diff", async ({ page }) => {
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
  await page.getByRole("button", { name: "Import MIDI" }).click();
  await page.waitForSelector(".piano-roll-toolbar");

  const scope = page.getByLabel("Playback scope");
  await expect(scope.locator('option[value="changed"]')).toHaveAttribute("disabled", "");
  await page.getByRole("button", { name: "Re-run separation" }).click();
  const importValue = await page
    .locator(".diff-target-select option", { hasText: "Import" })
    .getAttribute("value");
  await page.locator(".diff-target-select").selectOption(importValue ?? "");
  await expect(scope.locator('option[value="changed"]')).not.toHaveAttribute("disabled");
  await scope.selectOption("changed");
  await expect(scope).toHaveValue("changed");

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await page.getByRole("button", { name: "Stop" }).click();
});
