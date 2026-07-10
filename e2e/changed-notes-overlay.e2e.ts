import { expect, test, type Page } from "@playwright/test";
import { buildFixtureProject, installFakeTauri, note, voice } from "./fixtures/tauriMock";

// The moved and unchanged notes share a pitch row, so the latter proves that
// the filter reaches the real canvas draw loop, rather than just the controls.
const project = buildFixtureProject(
  [
    note("moved", "voice-1", 60, 0, { endTick: 480 }),
    note("unchanged", "voice-1", 60, 960, { endTick: 1440 }),
  ],
  [voice("voice-1", "Lead", 2, 60, 60), voice("voice-2", "Bass", 0, 36, 48)],
  { durationTicks: 1920 },
);

async function importFixture(page: Page) {
  await page.getByRole("button", { name: "Import MIDI" }).click();
  await page.waitForSelector(".diff-summary");
}

async function selectImportComparison(page: Page) {
  const value = await page
    .locator(".diff-target-select option", { hasText: "Import" })
    .getAttribute("value");
  await page.locator(".diff-target-select").selectOption(value ?? "");
}

test("changed-note controls highlight and filter the rendered piano roll", async ({ page }) => {
  await installFakeTauri(page, {
    importedProject: project,
    reassign: ({ project: current }) => ({
      ...current,
      notes: current.notes.map((entry) =>
        entry.id === "moved" ? { ...entry, voiceId: "voice-2" } : entry,
      ),
    }),
  });
  await page.goto("/");
  await importFixture(page);
  await page.getByRole("button", { name: "Re-run separation" }).click();
  await selectImportComparison(page);

  const showChanges = page.getByLabel("Show changes in piano roll");
  const onlyChanges = page.getByLabel("Only changed notes");
  await expect(showChanges).toBeEnabled();
  await expect(onlyChanges).toBeDisabled();
  await showChanges.check();
  await onlyChanges.check();

  const [r, g, b] = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      'canvas[aria-label="Piano roll note visualization"]',
    );
    const context = canvas?.getContext("2d");
    if (!canvas || !context) throw new Error("Piano roll canvas is unavailable");
    const ratio = window.devicePixelRatio || 1;
    const x = 56 + ((960 + 1440) / 2 / 1920) * (canvas.clientWidth - 56);
    const y = canvas.clientHeight / 2;
    return [...context.getImageData(Math.round(x * ratio), Math.round(y * ratio), 1, 1).data];
  });
  // The unchanged note's center has returned to the dark canvas background.
  expect(r).toBeLessThan(100);
  expect(g).toBeLessThan(100);
  expect(b).toBeLessThan(100);
});
