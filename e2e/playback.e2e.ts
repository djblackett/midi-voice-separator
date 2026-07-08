import { expect, test, type Page } from "@playwright/test";
import { buildFixtureProject, installFakeTauri, note, voice } from "./fixtures/tauriMock";

// Minimap-click seeking is deliberately not covered here for the same
// reason direct canvas note selection isn't (see
// selection-and-reassignment.e2e.ts): it's a second canvas-coordinate-math
// surface with lower marginal value than the Play/Pause/Stop wiring below,
// which is what nothing else exercises.

// ppq 480 at the default 120 BPM tempo map = 0.5s per quarter note; 8
// quarter notes (3840 ticks) gives ~4s of playback, enough room to observe
// the time readout advance before the piece ends.
const project = buildFixtureProject(
  [
    note("a", "voice-1", 60, 0, { endTick: 480 }),
    note("b", "voice-1", 64, 960, { endTick: 1440 }),
    note("c", "voice-1", 67, 1920, { endTick: 2400 }),
    note("d", "voice-1", 72, 2880, { endTick: 3360 }),
  ],
  [voice("voice-1", "Voice 1", 4, 60, 72)],
  { durationTicks: 3840 },
);

async function importFixture(page: Page) {
  await page.getByRole("button", { name: "Import MIDI" }).click();
  await page.waitForSelector(".piano-roll-toolbar");
}

async function currentTimeText(page: Page) {
  const text = await page.locator(".playback-time").innerText();
  return text.split("/")[0].trim();
}

test.describe("playback", () => {
  test("Play advances the time readout, and Pause freezes it", async ({ page }) => {
    await installFakeTauri(page, { importedProject: project });
    await page.goto("/");
    await importFixture(page);

    await expect(page.locator(".playback-time")).toHaveText("0:00 / 0:04");

    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();

    await expect.poll(() => currentTimeText(page), { timeout: 5000 }).not.toBe("0:00");

    await page.getByRole("button", { name: "Pause" }).click();
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();

    const pausedAt = await currentTimeText(page);
    await page.waitForTimeout(300);
    expect(await currentTimeText(page)).toBe(pausedAt);
  });

  test("Stop resets the readout to zero and returns to Play", async ({ page }) => {
    await installFakeTauri(page, { importedProject: project });
    await page.goto("/");
    await importFixture(page);

    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect.poll(() => currentTimeText(page), { timeout: 5000 }).not.toBe("0:00");

    await page.getByRole("button", { name: "Stop" }).click();

    await expect(page.locator(".playback-time")).toHaveText("0:00 / 0:04");
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  });

  test("switching the Sound to Piano does not error", async ({ page }) => {
    const pageErrors: string[] = [];
    await installFakeTauri(page, { importedProject: project });
    await page.goto("/");
    await importFixture(page);
    page.on("pageerror", (err) => pageErrors.push(String(err)));
    page.on("console", (msg) => {
      if (msg.type() === "error") pageErrors.push(msg.text());
    });

    await page.locator(".instrument-select").selectOption("piano");
    await expect(page.locator(".instrument-select")).toHaveValue("piano");

    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
    await page.getByRole("button", { name: "Stop" }).click();

    expect(pageErrors).toEqual([]);
  });
});
