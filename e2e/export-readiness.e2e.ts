import { expect, test, type Page } from "@playwright/test";
import { buildFixtureProject, installFakeTauri, note, voice } from "./fixtures/tauriMock";

const readinessProject = buildFixtureProject(
  [
    note("flagged", "voice-1", 60, 0, { assignmentConfidence: 0.3 }),
    note("tiny", "voice-3", 76, 240),
    note("kick", "percussion", 36, 480, { assignmentReason: "PERCUSSION" }),
  ],
  [
    voice("voice-1", "Voice 1", 1, 60, 60),
    voice("voice-2", "Empty", 0, 0, 0),
    voice("voice-3", "Blip", 1, 76, 76),
    voice("percussion", "Percussion", 1, 36, 36),
  ],
  { separationSummary: { meanConfidence: 0.7, lowConfidenceNoteCount: 1, voiceCount: 4 } },
);

const cleanProject = buildFixtureProject(
  [
    note("bass-a", "bass", 48, 0),
    note("bass-b", "bass", 50, 240),
    note("lead-a", "lead", 72, 0),
    note("lead-b", "lead", 74, 240),
  ],
  [voice("bass", "Bass", 2, 48, 50), voice("lead", "Lead", 2, 72, 74)],
  { separationSummary: { meanConfidence: 0.95, lowConfidenceNoteCount: 0, voiceCount: 2 } },
);

const rerunProject = buildFixtureProject(
  [note("a", "voice-1", 60, 0), note("b", "voice-2", 72, 240)],
  [voice("voice-1", "Bass", 1, 60, 60), voice("voice-2", "Lead", 1, 72, 72)],
);

async function importFixture(page: Page) {
  await page.getByRole("button", { name: "Import MIDI" }).click();
  await page.waitForSelector(".export-readiness");
}

async function selectDiffTargetByText(page: Page, text: string) {
  const value = await page
    .locator(".diff-target-select option", { hasText: text })
    .getAttribute("value");
  await page.locator(".diff-target-select").selectOption(value ?? "");
}

function readiness(page: Page) {
  return page.getByLabel("Export readiness summary");
}

test.describe("export readiness", () => {
  test("shows advisory findings from current editor state without blocking export", async ({
    page,
  }) => {
    await installFakeTauri(page, { importedProject: readinessProject });
    await page.goto("/");
    await importFixture(page);

    await expect(readiness(page)).toContainText("advisory checks");
    await expect(readiness(page)).toContainText("1 flagged note still need review");
    await expect(readiness(page)).toContainText("Voice 1");
    await expect(readiness(page)).toContainText("Empty");
    await expect(readiness(page)).toContainText("Blip");
    await expect(readiness(page)).toContainText("1 note will export to the percussion voice");
    await expect(readiness(page)).toContainText("reimport the MIDI manually");

    await expect(page.getByRole("button", { name: "Export MIDI" })).toBeEnabled();
  });

  test("shows a no-blocking status when only the manual round-trip reminder remains", async ({
    page,
  }) => {
    await installFakeTauri(page, { importedProject: cleanProject });
    await page.goto("/");
    await importFixture(page);

    await expect(readiness(page)).toContainText("no blocking checks");
    await expect(readiness(page)).toContainText("Round trip");
    await expect(readiness(page)).toContainText("reimport the MIDI manually");
    await expect(readiness(page)).not.toContainText("advisory checks");
    await expect(readiness(page)).not.toContainText("Flagged review");
    await expect(page.getByRole("button", { name: "Export MIDI" })).toBeEnabled();
  });

  test("reports unlocked notes changed since the selected baseline snapshot", async ({ page }) => {
    await installFakeTauri(page, {
      importedProject: rerunProject,
      reassign: ({ project }) => ({
        ...project,
        notes: project.notes.map((n) => (n.id === "a" ? { ...n, voiceId: "voice-2" } : n)),
      }),
    });
    await page.goto("/");
    await importFixture(page);

    await page.getByRole("button", { name: "Re-run separation" }).click();
    await page.waitForSelector(".snapshot-list li:nth-child(3)");
    await selectDiffTargetByText(page, "Import");

    await expect(readiness(page)).toContainText(
      "1 changed note is not locked against the selected baseline",
    );
  });
});
