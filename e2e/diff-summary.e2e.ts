import { expect, test, type Page } from "@playwright/test";
import { buildFixtureProject, installFakeTauri, note, voice } from "./fixtures/tauriMock";

// A plausible register split: 3 low notes in voice-1, 3 high notes in
// voice-2, with one low-confidence note in each voice a re-run could
// plausibly clean up.
const registerSplitProject = buildFixtureProject(
  [
    note("a", "voice-1", 40, 0, { assignmentConfidence: 0.3 }),
    note("b", "voice-1", 42, 120),
    note("c", "voice-1", 44, 240),
    note("d", "voice-2", 70, 360),
    note("e", "voice-2", 73, 480),
    note("f", "voice-2", 76, 600, { assignmentConfidence: 0.4 }),
  ],
  [voice("voice-1", "Voice 1", 3, 40, 44), voice("voice-2", "Voice 2", 3, 70, 76)],
  { separationSummary: { meanConfidence: 0.72, lowConfidenceNoteCount: 2, voiceCount: 2 } },
);

async function importFixture(page: Page) {
  await page.getByRole("button", { name: "Import MIDI" }).click();
  await page.waitForSelector(".diff-summary", { timeout: 5000 });
}

async function selectDiffTargetByText(page: Page, text: string) {
  const value = await page
    .locator(".diff-target-select option", { hasText: text })
    .getAttribute("value");
  await page.locator(".diff-target-select").selectOption(value ?? "");
}

async function statsRow(page: Page, label: string) {
  return page.locator(".diff-summary-stats div", { hasText: label }).innerText();
}

test.describe("assignment diff summary", () => {
  test("with no edits, comparing current to Import shows zero changes", async ({ page }) => {
    await installFakeTauri(page, { importedProject: registerSplitProject });
    await page.goto("/");
    await importFixture(page);

    await selectDiffTargetByText(page, "Import");

    await expect.poll(() => statsRow(page, "Notes reassigned")).toContain("0");
    await expect.poll(() => statsRow(page, "Voices added")).toContain("0");
    await expect.poll(() => statsRow(page, "Voices removed")).toContain("0");
    await expect.poll(() => statsRow(page, "Confidence")).toContain("No confidence change");
  });

  test("a strategy-change re-run that reallocates voice ids reads as a sane diff, not id-permutation noise", async ({
    page,
  }) => {
    await installFakeTauri(page, {
      importedProject: registerSplitProject,
      // Simulates a real re-run: fresh voice ids (voice-1/2 -> voice-5/6)
      // for the *same* grouping, plus one genuine register-driven move
      // (note "c", the borderline-pitch note, crosses into the high
      // register voice) and two confidence improvements.
      reassign: ({ project }) => {
        const remap: Record<string, string> = { "voice-1": "voice-5", "voice-2": "voice-6" };
        return {
          ...project,
          notes: project.notes.map((n) => {
            if (n.id === "c") {
              return { ...n, voiceId: "voice-6", assignmentConfidence: 0.6 };
            }
            return {
              ...n,
              voiceId: remap[n.voiceId] ?? n.voiceId,
              assignmentConfidence: n.id === "a" || n.id === "f" ? 0.85 : n.assignmentConfidence,
            };
          }),
          separationSummary: { meanConfidence: 0.85, lowConfidenceNoteCount: 0, voiceCount: 2 },
        };
      },
    });
    await page.goto("/");
    await importFixture(page);

    await page.locator(".separation-strategy-select").selectOption("REGISTER_PRIORITY");
    await page.getByRole("button", { name: "Re-run separation" }).click();
    await page.waitForSelector(".snapshot-list li:nth-child(3)");

    await selectDiffTargetByText(page, "Import");

    // The core claim under test: reallocated voice ids must not read as
    // added/removed voices -- matchVoices pairs by content, not id.
    await expect.poll(() => statsRow(page, "Voices added")).toContain("0");
    await expect.poll(() => statsRow(page, "Voices removed")).toContain("0");
    // Exactly the one genuinely moved note, not every note in the project.
    await expect.poll(() => statsRow(page, "Notes reassigned")).toContain("1");
  });

  test("confidence delta is suppressed when stored assignment provenance differs", async ({
    page,
  }) => {
    await installFakeTauri(page, {
      importedProject: registerSplitProject,
      reassign: ({ project }) => ({
        ...project,
        notes: project.notes.map((n) =>
          n.id === "a" || n.id === "f" ? { ...n, assignmentConfidence: 0.85 } : n,
        ),
        separationSummary: { meanConfidence: 0.85, lowConfidenceNoteCount: 0, voiceCount: 2 },
      }),
    });
    await page.goto("/");
    await importFixture(page);

    // Import used BALANCED; the re-run below uses REGISTER_PRIORITY, so
    // current-vs-Import must not claim a comparable confidence delta.
    await page.locator(".separation-strategy-select").selectOption("REGISTER_PRIORITY");
    await page.getByRole("button", { name: "Re-run separation" }).click();
    await page.waitForSelector(".snapshot-list li:nth-child(3)");

    await selectDiffTargetByText(page, "Import");
    await expect.poll(() => statsRow(page, "Confidence")).toContain("Not comparable");

    // "Before rerun" is still the imported base assignment. Its saved
    // next-rerun controls are REGISTER_PRIORITY, but its applied provenance
    // remains import, so it must not be relabeled as comparable evidence.
    await selectDiffTargetByText(page, "Before rerun");
    await expect.poll(() => statsRow(page, "Confidence")).toContain("Not comparable");
  });
});
