import { expect, test, type Page } from "@playwright/test";
import { buildFixtureProject, installFakeTauri, note, voice } from "./fixtures/tauriMock";

const twoVoiceProject = buildFixtureProject(
  [
    note("a", "voice-1", 60, 0),
    note("b", "voice-1", 62, 120),
    note("c", "voice-2", 64, 240),
    note("d", "voice-2", 66, 360),
  ],
  [voice("voice-1", "Voice 1", 2, 60, 62), voice("voice-2", "Voice 2", 2, 64, 66)],
);

function voiceRow(page: Page, label: string) {
  return page
    .locator(".voice-legend li")
    .filter({ has: page.getByLabel(`Select notes in ${label}`, { exact: true }) });
}

test("an edit during rerun is preserved and drops the stale rerun result", async ({ page }) => {
  let resolveRerun: ((project: typeof twoVoiceProject) => void) | null = null;

  await installFakeTauri(page, {
    importedProject: twoVoiceProject,
    reassign: () =>
      new Promise((resolve) => {
        resolveRerun = resolve;
      }),
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Import MIDI" }).click();
  await page.waitForSelector(".voice-legend");

  await page.getByRole("button", { name: "Re-run separation" }).click();
  await expect.poll(() => resolveRerun !== null).toBe(true);

  await page.getByLabel("Select notes in Voice 1").click();
  await page.keyboard.press("2");
  await expect(voiceRow(page, "Voice 1")).toContainText("0 notes");
  await expect(voiceRow(page, "Voice 2")).toContainText("4 notes");

  resolveRerun!(twoVoiceProject);

  await expect(page.getByRole("alert")).toContainText(
    "Your edit during rerun was kept; rerun result dropped — rerun again.",
  );
  await expect(voiceRow(page, "Voice 1")).toContainText("0 notes");
  await expect(voiceRow(page, "Voice 2")).toContainText("4 notes");
});
