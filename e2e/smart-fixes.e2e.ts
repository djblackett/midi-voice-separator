import { expect, test, type Page } from "@playwright/test";
import { buildFixtureProject, installFakeTauri, note, voice } from "./fixtures/tauriMock";

const smartFixProject = buildFixtureProject(
  [
    note("lead-a", "voice-1", 60, 0),
    note("lead-b", "voice-1", 62, 240),
    note("split", "voice-2", 64, 480),
    note("lead-c", "voice-1", 65, 720),
    note("other-a", "voice-2", 84, 1440),
    note("other-b", "voice-2", 86, 1680),
  ],
  [voice("voice-1", "Lead", 3, 60, 65), voice("voice-2", "Other", 3, 64, 86)],
  { durationTicks: 1920 },
);

async function importFixture(page: Page) {
  await page.getByRole("button", { name: "Import MIDI" }).click();
  await page.waitForSelector(".piano-roll-toolbar");
}

test.describe("smart fix suggestions", () => {
  test("assign suggestion locks a split phrase note through the real UI", async ({ page }) => {
    await installFakeTauri(page, { importedProject: smartFixProject });
    await page.goto("/");
    await importFixture(page);

    const smartFixes = page.getByLabel("Smart fix suggestions");
    await expect(smartFixes).toContainText("Reconnect phrase into Lead");

    await smartFixes.getByRole("button", { name: "Assign note" }).click();

    await expect(page.locator(".selection-details")).toContainText("Pitch64");
    await expect(page.locator(".selection-details")).toContainText("voice-1");
    await expect(smartFixes).not.toContainText("Reconnect phrase into Lead");
  });
});
