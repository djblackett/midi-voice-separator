import { expect, test, type Page } from "@playwright/test";
import { buildFixtureProject, installFakeTauri, note, voice } from "./fixtures/tauriMock";

const threeVoiceProject = buildFixtureProject(
  [
    note("a", "voice-1", 60, 0),
    note("b", "voice-2", 64, 240),
    note("c", "voice-2", 66, 360),
    note("d", "voice-3", 70, 480),
  ],
  [
    voice("voice-1", "Voice 1", 1, 60, 60),
    voice("voice-2", "Voice 2", 2, 64, 66),
    voice("voice-3", "Voice 3", 1, 70, 70),
  ],
);

async function importFixture(page: Page) {
  await page.getByRole("button", { name: "Import MIDI" }).click();
  await page.waitForSelector(".voice-legend");
}

/**
 * The `<li>` row for a voice, located by its swatch's accessible name
 * (stable even after a rename, as long as the *current* label is passed).
 * getByLabel does substring matching by default, and a split-repair names
 * its new voice "<source label> Channel N" -- a literal superstring of the
 * source's own label -- so exact: true is required to avoid an inexact
 * "Voice 1" also matching "Voice 1 Channel 2".
 */
function voiceRow(page: Page, label: string) {
  return page
    .locator(".voice-legend li")
    .filter({ has: page.getByLabel(`Select notes in ${label}`, { exact: true }) });
}

test.describe("voice legend", () => {
  test("+ New voice appends an empty voice", async ({ page }) => {
    await installFakeTauri(page, { importedProject: threeVoiceProject });
    await page.goto("/");
    await importFixture(page);

    await expect(page.locator(".voice-legend li")).toHaveCount(3);
    await page.getByRole("button", { name: "+ New voice" }).click();
    await expect(page.locator(".voice-legend li")).toHaveCount(4);
    await expect(voiceRow(page, "Voice 4")).toContainText("0 notes");
  });

  test("renaming a voice updates its label", async ({ page }) => {
    await installFakeTauri(page, { importedProject: threeVoiceProject });
    await page.goto("/");
    await importFixture(page);

    await page.getByLabel("Rename Voice 1").fill("Bass");

    await expect(voiceRow(page, "Bass")).toHaveCount(1);
    await expect(page.locator(".voice-legend li")).toHaveCount(3);
  });

  test("renaming a voice is undoable without relying on input focus", async ({ page }) => {
    await installFakeTauri(page, { importedProject: threeVoiceProject });
    await page.goto("/");
    await importFixture(page);

    await page.getByLabel("Rename Voice 1").fill("Bass");
    await expect(voiceRow(page, "Bass")).toHaveCount(1);

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(voiceRow(page, "Voice 1")).toHaveCount(1);
  });

  test("merging a voice moves its notes and removes it from the legend", async ({ page }) => {
    await installFakeTauri(page, { importedProject: threeVoiceProject });
    await page.goto("/");
    await importFixture(page);

    await expect(voiceRow(page, "Voice 2")).toContainText("2 notes");

    await page.getByLabel("Merge Voice 3 into another voice").selectOption("voice-2");

    await expect(page.locator(".voice-legend li")).toHaveCount(2);
    await expect(voiceRow(page, "Voice 2")).toContainText("3 notes");
  });

  test("merge is undoable", async ({ page }) => {
    await installFakeTauri(page, { importedProject: threeVoiceProject });
    await page.goto("/");
    await importFixture(page);

    await page.getByLabel("Merge Voice 3 into another voice").selectOption("voice-2");
    await expect(page.locator(".voice-legend li")).toHaveCount(2);

    await page.getByRole("button", { name: "Undo" }).click();

    await expect(page.locator(".voice-legend li")).toHaveCount(3);
    await expect(voiceRow(page, "Voice 2")).toContainText("2 notes");
  });

  test("solo toggles aria-pressed and highlights only that voice's button", async ({ page }) => {
    await installFakeTauri(page, { importedProject: threeVoiceProject });
    await page.goto("/");
    await importFixture(page);

    const soloButton = voiceRow(page, "Voice 2").getByRole("button", { name: "Solo" });
    await expect(soloButton).toHaveAttribute("aria-pressed", "false");

    await soloButton.click();
    await expect(soloButton).toHaveAttribute("aria-pressed", "true");

    const otherSoloButton = voiceRow(page, "Voice 1").getByRole("button", { name: "Solo" });
    await expect(otherSoloButton).toHaveAttribute("aria-pressed", "false");

    // Clicking the same voice's Solo button again turns it off.
    await soloButton.click();
    await expect(soloButton).toHaveAttribute("aria-pressed", "false");
  });

  test("reordering moves a voice up and down in the legend", async ({ page }) => {
    await installFakeTauri(page, { importedProject: threeVoiceProject });
    await page.goto("/");
    await importFixture(page);

    // Voice labels fall back to a positional "Voice N" default when unset,
    // so they'd shift with reordering and stop identifying a specific
    // voice -- rename each one first so the label is a stable identity
    // anchor (an explicit voiceLabels entry always wins over the
    // positional fallback, regardless of index).
    await page.getByLabel("Rename Voice 1").fill("Bass");
    await page.getByLabel("Rename Voice 2").fill("Lead");
    await page.getByLabel("Rename Voice 3").fill("Drums");

    async function labelsInOrder() {
      return page
        .locator(".voice-legend .voice-name-input")
        .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
    }

    await expect.poll(labelsInOrder).toEqual(["Bass", "Lead", "Drums"]);

    await voiceRow(page, "Drums").getByRole("button", { name: "Move Drums up" }).click();
    await expect.poll(labelsInOrder).toEqual(["Bass", "Drums", "Lead"]);

    await voiceRow(page, "Bass").getByRole("button", { name: "Move Bass down" }).click();
    await expect.poll(labelsInOrder).toEqual(["Drums", "Bass", "Lead"]);
  });
});
