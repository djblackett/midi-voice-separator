import { expect, test, type Page } from "@playwright/test";
import { buildFixtureProject, installFakeTauri, note, voice } from "./fixtures/tauriMock";

const workspaceProject = buildFixtureProject(
  [note("a", "voice-1", 60, 0, { endTick: 480 }), note("b", "voice-2", 64, 480, { endTick: 960 })],
  [voice("voice-1", "Lead", 1, 60, 60), voice("voice-2", "Bass", 1, 64, 64)],
  { durationTicks: 960 },
);

async function importFixture(page: Page) {
  await page.getByRole("button", { name: "Import MIDI" }).click();
  await page.waitForSelector(".piano-roll-toolbar");
}

async function pianoRollBox(page: Page) {
  const canvas = page.getByLabel("Piano roll note visualization");
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error("Piano roll canvas has no bounding box");
  }
  return box;
}

test.describe("fullscreen editor workspace", () => {
  test("expands the piano roll while keeping paint controls visible", async ({ page }) => {
    await installFakeTauri(page, { importedProject: workspaceProject });
    await page.goto("/");
    await importFixture(page);

    const normalBox = await pianoRollBox(page);

    await page.getByRole("button", { name: "Fullscreen workspace" }).click();
    await expect(page.getByLabel("MIDI editor workspace")).toHaveClass(
      /editor-workspace-fullscreen/,
    );

    const fullscreenBox = await pianoRollBox(page);
    expect(fullscreenBox.height).toBeGreaterThan(normalBox.height);

    await page.getByRole("button", { name: "Paint mode: off" }).click();
    await expect(page.getByRole("group", { name: "Paint tool" })).toBeVisible();
    await expect(page.getByLabel("Brush size")).toBeVisible();

    await page.getByRole("button", { name: "Exit fullscreen" }).click();
    await expect(page.getByLabel("MIDI editor workspace")).not.toHaveClass(
      /editor-workspace-fullscreen/,
    );
  });
});
