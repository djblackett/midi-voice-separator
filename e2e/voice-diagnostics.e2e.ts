import { expect, test, type Page } from "@playwright/test";
import { buildFixtureProject, installFakeTauri, note, voice } from "./fixtures/tauriMock";

// Each voice mixes two channels at 60%/40% -- both clear
// MIXED_VOICE_CHANNEL_RATIO (0.2), so analyzeVoiceDiagnostics flags both as
// suspicious ("2 significant channels") and buildSplitVoiceByChannelRepair
// finds a real split (the minority channel, 2 notes, moves to a new
// voice). Pitches are kept within a few semitones so only the channel-split
// path triggers, not the wide-pitch-span path too, keeping the two
// repair kinds independently testable elsewhere if ever needed.
const twoSuspiciousVoicesProject = buildFixtureProject(
  [
    note("a", "voice-1", 60, 0, { channel: 0 }),
    note("b", "voice-1", 61, 120, { channel: 0 }),
    note("c", "voice-1", 62, 240, { channel: 0 }),
    note("d", "voice-1", 63, 360, { channel: 1 }),
    note("e", "voice-1", 64, 480, { channel: 1 }),
    note("f", "voice-2", 70, 600, { channel: 2 }),
    note("g", "voice-2", 71, 720, { channel: 2 }),
    note("h", "voice-2", 72, 840, { channel: 2 }),
    note("i", "voice-2", 73, 960, { channel: 3 }),
    note("j", "voice-2", 74, 1080, { channel: 3 }),
  ],
  [voice("voice-1", "Voice 1", 5, 60, 64), voice("voice-2", "Voice 2", 5, 70, 74)],
);

async function importFixture(page: Page) {
  await page.getByRole("button", { name: "Import MIDI" }).click();
  await page.waitForSelector(".voice-diagnostics");
}

function voiceRow(page: Page, label: string) {
  // getByLabel does substring matching by default, and a channel/pitch
  // split names the new voice "<source label> Channel N"/"Split above X" --
  // a literal superstring of the source's own label -- so an inexact match
  // on "Voice 1" would also match "Voice 1 Channel 2". exact: true avoids it.
  return page
    .locator(".voice-legend li")
    .filter({ has: page.getByLabel(`Select notes in ${label}`, { exact: true }) });
}

function diagnosticRow(page: Page, label: string) {
  // Same substring-collision risk as voiceRow, applied to hasText: anchor
  // on "<label>:" (formatVoiceDiagnosticSummary's own separator) so
  // "Voice 1:" can't also match a "Voice 1 Channel 2:" row.
  return page.locator(".voice-diagnostics-list li").filter({ hasText: new RegExp(`^${label}:`) });
}

test.describe("voice diagnostics", () => {
  test("both mixed-channel voices are flagged suspicious with a reason", async ({ page }) => {
    await installFakeTauri(page, { importedProject: twoSuspiciousVoicesProject });
    await page.goto("/");
    await importFixture(page);

    await expect(page.locator(".voice-diagnostics summary")).toContainText("2 suspicious of 2");
    await expect(diagnosticRow(page, "Voice 1")).toHaveClass(/suspicious/);
    await expect(diagnosticRow(page, "Voice 1")).toContainText("2 significant channels");
  });

  test("Focus in roll selects every note in that voice and solos it", async ({ page }) => {
    await installFakeTauri(page, { importedProject: twoSuspiciousVoicesProject });
    await page.goto("/");
    await importFixture(page);

    await diagnosticRow(page, "Voice 1").getByRole("button", { name: "Focus in roll" }).click();

    await expect(page.locator(".selection-details")).toContainText("5 notes selected");
    await expect(voiceRow(page, "Voice 1").getByRole("button", { name: "Solo" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("splitting one voice by channel moves the minority channel to a new voice", async ({
    page,
  }) => {
    await installFakeTauri(page, { importedProject: twoSuspiciousVoicesProject });
    await page.goto("/");
    await importFixture(page);

    await diagnosticRow(page, "Voice 1")
      .getByRole("button", { name: "Split Channel 2 (2 notes)" })
      .click();

    await expect(page.locator(".voice-legend li")).toHaveCount(3);
    await expect(voiceRow(page, "Voice 1")).toContainText("3 notes");
    // handleSplitVoiceByChannel names the new voice "<source> <channel>",
    // not a positional "Voice 3" fallback.
    await expect(voiceRow(page, "Voice 1 Channel 2")).toContainText("2 notes");
  });

  test("the channel split is undoable", async ({ page }) => {
    await installFakeTauri(page, { importedProject: twoSuspiciousVoicesProject });
    await page.goto("/");
    await importFixture(page);

    await diagnosticRow(page, "Voice 1")
      .getByRole("button", { name: "Split Channel 2 (2 notes)" })
      .click();
    await expect(page.locator(".voice-legend li")).toHaveCount(3);

    await page.getByRole("button", { name: "Undo" }).click();

    await expect(page.locator(".voice-legend li")).toHaveCount(2);
    await expect(voiceRow(page, "Voice 1")).toContainText("5 notes");
  });

  test("Split all mixed-channel voices repairs every flagged voice at once", async ({ page }) => {
    await installFakeTauri(page, { importedProject: twoSuspiciousVoicesProject });
    await page.goto("/");
    await importFixture(page);

    await page.getByRole("button", { name: "Split all mixed-channel voices (2)" }).click();

    await expect(page.locator(".voice-legend li")).toHaveCount(4);
    await expect(voiceRow(page, "Voice 1")).toContainText("3 notes");
    await expect(voiceRow(page, "Voice 2")).toContainText("3 notes");
    await expect(page.locator(".voice-diagnostics summary")).toContainText("0 suspicious of 4");
  });
});
