import { expect, test, type Page } from "@playwright/test";
import { buildFixtureProject, installFakeTauri, note, voice } from "./fixtures/tauriMock";

const project = buildFixtureProject(
  [note("a", "voice-1", 60, 0), note("b", "voice-1", 62, 120), note("c", "voice-2", 64, 240)],
  [voice("voice-1", "Voice 1", 2, 60, 62), voice("voice-2", "Voice 2", 1, 64, 64)],
);

function voiceRow(page: Page, label: string) {
  return page
    .locator(".voice-legend li")
    .filter({ has: page.getByLabel(`Select notes in ${label}`, { exact: true }) });
}

test("a re-run that reallocates voice ids keeps user labels via correspondence", async ({
  page,
}) => {
  await installFakeTauri(page, {
    importedProject: project,
    // A full re-run: the same grouping under fresh voice ids (voice-1/2 -> 5/6).
    reassign: ({ project: current }) => {
      const remap: Record<string, string> = { "voice-1": "voice-5", "voice-2": "voice-6" };
      return {
        ...current,
        notes: current.notes.map((entry) => ({
          ...entry,
          voiceId: remap[entry.voiceId] ?? entry.voiceId,
        })),
      };
    },
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Import MIDI" }).click();
  await page.waitForSelector(".voice-legend");

  // Give the first voice a custom label.
  await page.getByLabel("Rename Voice 1").fill("Melody");
  await expect(voiceRow(page, "Melody")).toHaveCount(1);

  await page.getByRole("button", { name: "Re-run separation" }).click();

  // Despite the id reallocation, the label followed its voice through
  // correspondence rather than being orphaned onto a default label.
  await expect(voiceRow(page, "Melody")).toHaveCount(1);
  await expect(voiceRow(page, "Melody")).toContainText("2 notes");
});
