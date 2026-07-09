import { expect, test, type Page } from "@playwright/test";
import { buildFixtureProject, installFakeTauri, note, voice } from "./fixtures/tauriMock";

// Two flagged (confidence < 0.5) notes, time-sorted b (tick 200) then d
// (tick 600), interleaved with two unflagged notes -- exercises
// buildFlaggedNoteQueue's sort and findNextFlaggedNoteId's wraparound.
const project = buildFixtureProject(
  [
    note("a", "voice-1", 60, 0, { assignmentConfidence: 0.9 }),
    note("b", "voice-1", 62, 200, { assignmentConfidence: 0.3 }),
    note("c", "voice-1", 64, 400, { assignmentConfidence: 0.9 }),
    note("d", "voice-1", 66, 600, { assignmentConfidence: 0.2 }),
  ],
  [voice("voice-1", "Voice 1", 4, 60, 66)],
  { separationSummary: { meanConfidence: 0.575, lowConfidenceNoteCount: 2, voiceCount: 1 } },
);

const twoVoiceReviewProject = buildFixtureProject(
  [
    note("a", "voice-1", 60, 0, { assignmentConfidence: 0.9 }),
    note("b", "voice-1", 62, 200, { assignmentConfidence: 0.3 }),
    note("c", "voice-2", 72, 400, { assignmentConfidence: 0.9 }),
    note("d", "voice-2", 74, 600, { assignmentConfidence: 0.2 }),
  ],
  [voice("voice-1", "Voice 1", 2, 60, 62), voice("voice-2", "Voice 2", 2, 72, 74)],
  { separationSummary: { meanConfidence: 0.575, lowConfidenceNoteCount: 2, voiceCount: 2 } },
);

async function importFixture(page: Page) {
  await page.getByRole("button", { name: "Import MIDI" }).click();
  await page.waitForSelector(".separation-summary");
}

async function selectedPitch(page: Page) {
  const dd = page.locator(".selection-details dl dd").first();
  return dd.innerText();
}

function reviewPanel(page: Page) {
  return page.getByLabel("Guided flagged-note review");
}

function voiceRow(page: Page, label: string) {
  return page
    .locator(".voice-legend li")
    .filter({ has: page.getByLabel(`Select notes in ${label}`, { exact: true }) });
}

test.describe("review mode", () => {
  test("the separation summary shows the flagged note count", async ({ page }) => {
    await installFakeTauri(page, { importedProject: project });
    await page.goto("/");
    await importFixture(page);

    await expect(page.getByRole("button", { name: "Review flagged notes (2)" })).toBeVisible();
  });

  test("the review button selects the first flagged note by time", async ({ page }) => {
    await installFakeTauri(page, { importedProject: project });
    await page.goto("/");
    await importFixture(page);

    await page.getByRole("button", { name: "Review flagged notes (2)" }).click();

    expect(await selectedPitch(page)).toBe("62"); // note "b", the earlier flagged note
  });

  test("Tab steps forward through flagged notes and wraps around", async ({ page }) => {
    await installFakeTauri(page, { importedProject: project });
    await page.goto("/");
    await importFixture(page);

    await page.getByRole("button", { name: "Review flagged notes (2)" }).click();
    expect(await selectedPitch(page)).toBe("62"); // b

    await page.keyboard.press("Tab");
    expect(await selectedPitch(page)).toBe("66"); // d

    await page.keyboard.press("Tab");
    expect(await selectedPitch(page)).toBe("62"); // wraps back to b
  });

  test("Shift+Tab steps backward and wraps the other way", async ({ page }) => {
    await installFakeTauri(page, { importedProject: project });
    await page.goto("/");
    await importFixture(page);

    await page.getByRole("button", { name: "Review flagged notes (2)" }).click();
    expect(await selectedPitch(page)).toBe("62"); // b

    await page.keyboard.press("Shift+Tab");
    expect(await selectedPitch(page)).toBe("66"); // wraps to the last flagged note, d
  });

  test("guided skip counts the selected flagged note as reviewed for this session", async ({
    page,
  }) => {
    await installFakeTauri(page, { importedProject: project });
    await page.goto("/");
    await importFixture(page);

    await page.getByRole("button", { name: "Review flagged notes (2)" }).click();
    await expect(reviewPanel(page)).toContainText("0 of 2 reviewed");

    await reviewPanel(page).getByRole("button", { name: "Skip" }).click();

    await expect(reviewPanel(page)).toContainText("1 of 2 reviewed");
  });

  test("Accept & lock sends the accepted flagged note as a locked re-run constraint", async ({
    page,
  }) => {
    let lockedSeen: Record<string, string> | null = null;
    await installFakeTauri(page, {
      importedProject: project,
      reassign: ({ project: currentProject, locked }) => {
        lockedSeen = locked;
        return currentProject;
      },
    });
    await page.goto("/");
    await importFixture(page);

    await page.getByRole("button", { name: "Review flagged notes (2)" }).click();
    await reviewPanel(page).getByRole("button", { name: "Accept & lock" }).click();
    await expect(reviewPanel(page)).toContainText("1 of 2 reviewed");

    await page.getByRole("button", { name: "Re-run separation" }).click();
    await expect.poll(() => lockedSeen).toEqual({ b: "voice-1" });
  });

  test("Assign to voice updates the current flagged note and review progress", async ({ page }) => {
    await installFakeTauri(page, { importedProject: twoVoiceReviewProject });
    await page.goto("/");
    await importFixture(page);

    await page.getByRole("button", { name: "Review flagged notes (2)" }).click();
    await reviewPanel(page).getByLabel("Assign to").selectOption("voice-2");

    await expect(reviewPanel(page)).toContainText("1 of 2 reviewed");
    await expect(voiceRow(page, "Voice 1")).toContainText("1 notes");
    await expect(voiceRow(page, "Voice 2")).toContainText("3 notes");
  });
});
