import { expect, test, type Page } from "@playwright/test";
import { buildFixtureProject, installFakeTauri, note, voice } from "./fixtures/tauriMock";

// All three notes start in voice-1 (deliberately "wrong" for two of them) so
// applying ranges has something visible to redistribute: default rules map
// "above Marker 1" -> voice-1, "Marker 2 to Marker 1" -> voice-2, "below
// Marker 2" -> voice-3 (buildDefaultVoiceRangeRules). Markers are set
// explicitly in each test rather than relying on the auto-computed
// defaults, so the expected redistribution is deterministic.
const threeVoiceProject = buildFixtureProject(
  [
    note("high", "voice-1", 80, 0),
    note("mid", "voice-1", 60, 240),
    note("low", "voice-1", 40, 480),
  ],
  [
    voice("voice-1", "Voice 1", 3, 40, 80),
    voice("voice-2", "Voice 2", 0, 0, 0),
    voice("voice-3", "Voice 3", 0, 0, 0),
  ],
);

async function importFixture(page: Page) {
  await page.getByRole("button", { name: "Import MIDI" }).click();
  await page.waitForSelector(".range-rules");
}

// exact: true avoids getByLabel's default substring matching -- a channel
// split names its new voice "<source label> Channel N", a literal
// superstring of the source's own label.
function voiceRow(page: Page, label: string) {
  return page
    .locator(".voice-legend li")
    .filter({ has: page.getByLabel(`Select notes in ${label}`, { exact: true }) });
}

async function setMarkers(page: Page, marker1: number, marker2: number) {
  await page.getByLabel("Marker 1").fill(String(marker1));
  await page.getByLabel("Marker 2").fill(String(marker2));
}

test.describe("pitch range rules", () => {
  test("the rule list describes each range from the current marker pitches", async ({ page }) => {
    await installFakeTauri(page, { importedProject: threeVoiceProject });
    await page.goto("/");
    await importFixture(page);

    await setMarkers(page, 70, 50);

    const rules = page.locator(".range-rule-list li");
    await expect(rules).toHaveCount(3);
    await expect(rules.nth(0)).toContainText("Pitch > 70");
    await expect(rules.nth(1)).toContainText("50 < pitch <= 70");
    await expect(rules.nth(2)).toContainText("Pitch <= 50");
  });

  test("Apply ranges redistributes notes to the matching voice by pitch", async ({ page }) => {
    await installFakeTauri(page, { importedProject: threeVoiceProject });
    await page.goto("/");
    await importFixture(page);

    await setMarkers(page, 70, 50);
    await page.getByRole("button", { name: "Apply ranges" }).click();

    await expect(voiceRow(page, "Voice 1")).toContainText("1 notes"); // pitch 80, above 70
    await expect(voiceRow(page, "Voice 2")).toContainText("1 notes"); // pitch 60, between
    await expect(voiceRow(page, "Voice 3")).toContainText("1 notes"); // pitch 40, below/equal 50
  });

  test("applying ranges is undoable as one step", async ({ page }) => {
    await installFakeTauri(page, { importedProject: threeVoiceProject });
    await page.goto("/");
    await importFixture(page);

    await setMarkers(page, 70, 50);
    await page.getByRole("button", { name: "Apply ranges" }).click();
    await expect(voiceRow(page, "Voice 3")).toContainText("1 notes");

    await page.getByRole("button", { name: "Undo" }).click();

    await expect(voiceRow(page, "Voice 1")).toContainText("3 notes");
    await expect(voiceRow(page, "Voice 3")).toContainText("0 notes");
  });

  test("reapplying ranges after a hand correction preserves the hand-corrected note", async ({
    page,
  }) => {
    await installFakeTauri(page, { importedProject: threeVoiceProject });
    await page.goto("/");
    await importFixture(page);

    await setMarkers(page, 70, 50);
    await page.getByRole("button", { name: "Apply ranges" }).click();
    await expect(voiceRow(page, "Voice 2")).toContainText("1 notes"); // "mid" (pitch 60)

    // Hand-correct "mid" back to Voice 1 via the swatch-select + number-key
    // path (already covered as a real interaction in
    // selection-and-reassignment.e2e.ts). Voice 1 now holds "high" (from
    // the range apply) plus the hand-corrected "mid".
    await page.getByLabel("Select notes in Voice 2").click();
    await page.keyboard.press("1");
    await expect(voiceRow(page, "Voice 1")).toContainText("2 notes");
    await expect(voiceRow(page, "Voice 2")).toContainText("0 notes");

    // Nudge Marker 1 down and reapply -- the freshly computed patch would
    // put "mid" back in Voice 2 (50 < 60 <= 65) if hand-correction
    // provenance weren't tracked; it must not silently snap back.
    await page.getByLabel("Marker 1").fill("65");
    await page.getByRole("button", { name: "Apply ranges" }).click();

    await expect(voiceRow(page, "Voice 1")).toContainText("2 notes"); // "high" (80) + hand-corrected "mid"
    await expect(voiceRow(page, "Voice 2")).toContainText("0 notes");
  });
});
