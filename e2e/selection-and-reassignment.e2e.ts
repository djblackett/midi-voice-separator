import { expect, test, type Page } from "@playwright/test";
import { buildFixtureProject, installFakeTauri, note, voice } from "./fixtures/tauriMock";

// Direct canvas click/shift-click/marquee selection is deliberately not
// covered here: it would require replicating buildViewport's pitch/tick-to-
// pixel math (which depends on the actual rendered canvas size) inside the
// test just to click the right spot. That gesture logic is already ~100%
// unit-tested (selection.ts, hitTest.ts) and PianoRoll.tsx's pointer-event
// glue is the same documented "thin, untested by convention" category as
// its canvas draw calls (see agents.md). This suite instead drives
// selection through the voice-swatch click -- a real, already-supported
// selection path -- to reach the *un*tested part: App.tsx's keydown
// handler for bulk reassignment, undo/redo, and Escape.

const threeVoiceProject = buildFixtureProject(
  [
    note("a", "voice-1", 60, 0),
    note("b", "voice-1", 62, 120),
    note("c", "voice-2", 64, 240),
    note("d", "voice-3", 70, 360),
  ],
  [
    voice("voice-1", "Voice 1", 2, 60, 62),
    voice("voice-2", "Voice 2", 1, 64, 64),
    voice("voice-3", "Voice 3", 1, 70, 70),
  ],
);

async function importFixture(page: Page) {
  await page.getByRole("button", { name: "Import MIDI" }).click();
  await page.waitForSelector(".voice-legend");
}

// exact: true avoids getByLabel's default substring matching -- a channel
// split names its new voice "<source label> Channel N", a literal
// superstring of the source's own label.
function voiceRow(page: Page, label: string) {
  return page
    .locator(".voice-legend li")
    .filter({ has: page.getByLabel(`Select notes in ${label}`, { exact: true }) });
}

test.describe("selection and bulk reassignment", () => {
  test("clicking a voice swatch selects every note in that voice", async ({ page }) => {
    await installFakeTauri(page, { importedProject: threeVoiceProject });
    await page.goto("/");
    await importFixture(page);

    await page.getByLabel("Select notes in Voice 1").click();

    await expect(page.locator(".selection-details")).toContainText("2 notes selected");
    await expect(page.locator(".selection-details")).toContainText("pitches 60-62");
  });

  test("a single-note selection shows the detail view instead of the summary", async ({ page }) => {
    await installFakeTauri(page, { importedProject: threeVoiceProject });
    await page.goto("/");
    await importFixture(page);

    await page.getByLabel("Select notes in Voice 3").click();

    const details = page.locator(".selection-details dl");
    await expect(details).toContainText("70"); // pitch
    await expect(details).toContainText("voice-3");
  });

  test("pressing a number key reassigns the selection to that voice", async ({ page }) => {
    await installFakeTauri(page, { importedProject: threeVoiceProject });
    await page.goto("/");
    await importFixture(page);

    await page.getByLabel("Select notes in Voice 1").click();
    await page.keyboard.press("2");

    await expect(voiceRow(page, "Voice 1")).toContainText("0 notes");
    await expect(voiceRow(page, "Voice 2")).toContainText("3 notes");
  });

  test("a bulk reassignment is undoable and redoable", async ({ page }) => {
    await installFakeTauri(page, { importedProject: threeVoiceProject });
    await page.goto("/");
    await importFixture(page);

    await page.getByLabel("Select notes in Voice 1").click();
    await page.keyboard.press("2");
    await expect(voiceRow(page, "Voice 2")).toContainText("3 notes");

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(voiceRow(page, "Voice 1")).toContainText("2 notes");
    await expect(voiceRow(page, "Voice 2")).toContainText("1 notes");

    await page.getByRole("button", { name: "Redo" }).click();
    await expect(voiceRow(page, "Voice 1")).toContainText("0 notes");
    await expect(voiceRow(page, "Voice 2")).toContainText("3 notes");
  });

  test("Escape clears the current selection", async ({ page }) => {
    await installFakeTauri(page, { importedProject: threeVoiceProject });
    await page.goto("/");
    await importFixture(page);

    await page.getByLabel("Select notes in Voice 1").click();
    await expect(page.locator(".selection-details")).toContainText("2 notes selected");

    await page.keyboard.press("Escape");
    await expect(page.locator(".selection-details")).toContainText("No note selected");
  });
});
