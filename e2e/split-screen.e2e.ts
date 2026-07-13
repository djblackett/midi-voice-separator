import { expect, test, type Page } from "@playwright/test";
import { buildFixtureProject, installFakeTauri, note, voice } from "./fixtures/tauriMock";

const project = buildFixtureProject(
  [note("a", "voice-1", 60, 0), note("b", "voice-1", 62, 120), note("c", "voice-2", 64, 240)],
  [voice("voice-1", "Lead", 2, 60, 62), voice("voice-2", "Bass", 1, 64, 64)],
  { durationTicks: 3840 },
);

function voiceRow(page: Page, label: string) {
  return page
    .locator(".voice-legend li")
    .filter({ has: page.getByLabel(`Select notes in ${label}`, { exact: true }) });
}

async function currentTimeText(page: Page) {
  const text = await page.locator(".playback-time").innerText();
  return text.split("/")[0].trim();
}

async function startCompare(page: Page) {
  await page.getByRole("button", { name: "Import MIDI" }).click();
  await page.waitForSelector(".diff-summary");
  await page.getByRole("button", { name: "Re-run separation" }).click();
  const importValue = await page
    .locator(".diff-target-select option", { hasText: "Import" })
    .getAttribute("value");
  await page.locator(".diff-target-select").selectOption(importValue ?? "");
  await page.getByRole("button", { name: "Start A/B compare" }).click();
}

test("split view shows both sides and clicking a pane sets the active side", async ({ page }) => {
  await installFakeTauri(page, {
    importedProject: project,
    reassign: ({ project: current }) => ({
      ...current,
      notes: current.notes.map((entry) =>
        entry.id === "a" ? { ...entry, voiceId: "voice-2" } : entry,
      ),
    }),
  });
  await page.goto("/");
  await startCompare(page);

  await page.getByRole("button", { name: "Split view" }).click();

  // Both sides render as side-qualified panes.
  await expect(page.locator(".editor-pane")).toHaveCount(2);
  await expect(page.getByRole("group", { name: /Side A piano roll/ })).toBeVisible();
  await expect(page.getByRole("group", { name: /Side B piano roll/ })).toBeVisible();

  // Side A is the active (editable) side by default.
  await expect(page.locator(".editor-pane-active")).toContainText("Side A");

  // Clicking the Side B pane makes B the active side.
  await page.getByRole("group", { name: /Side B piano roll/ }).click();
  await expect(page.locator(".editor-pane-active")).toContainText("Side B");
  await expect(page.getByRole("button", { name: "B: Draft" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // Returning to single view collapses the split.
  await page.getByRole("button", { name: "Single view" }).click();
  await expect(page.locator(".editor-split")).toHaveCount(0);
});

test("Alt+A / Alt+B switch the active side from the keyboard without firing Brush", async ({
  page,
}) => {
  await installFakeTauri(page, {
    importedProject: project,
    reassign: ({ project: current }) => ({
      ...current,
      notes: current.notes.map((entry) =>
        entry.id === "a" ? { ...entry, voiceId: "voice-2" } : entry,
      ),
    }),
  });
  await page.goto("/");
  await startCompare(page);
  await page.getByRole("button", { name: "Split view" }).click();
  await expect(page.locator(".editor-pane-active")).toContainText("Side A");

  // Alt+B activates side B -- and must NOT enter Brush (bare B is Brush).
  await page.keyboard.press("Alt+b");
  await expect(page.locator(".editor-pane-active")).toContainText("Side B");
  await expect(page.getByRole("button", { name: "Paint mode: off" })).toBeVisible();

  // Alt+A switches back.
  await page.keyboard.press("Alt+a");
  await expect(page.locator(".editor-pane-active")).toContainText("Side A");
});

test("the transport monitors the active side and keeps rolling when it switches", async ({
  page,
}) => {
  await installFakeTauri(page, {
    importedProject: project,
    reassign: ({ project: current }) => ({
      ...current,
      notes: current.notes.map((entry) =>
        entry.id === "a" ? { ...entry, voiceId: "voice-2" } : entry,
      ),
    }),
  });
  await page.goto("/");
  await startCompare(page);
  await page.getByRole("button", { name: "Split view" }).click();

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(page.getByText("Sounding: A (Current)")).toBeVisible();

  // Switching the active side while playing reschedules to B and keeps playing
  // (Stop/Pause stay available -- the transport never stops to swap sources).
  await page.keyboard.press("Alt+b");
  await expect(page.getByText("Sounding: B (Draft)")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Stop" })).toBeEnabled();
});

test("a pinned monitor stays independent of the active editor side", async ({ page }) => {
  await installFakeTauri(page, {
    importedProject: project,
    reassign: ({ project: current }) => ({
      ...current,
      notes: current.notes.map((entry) =>
        entry.id === "a" ? { ...entry, voiceId: "voice-2" } : entry,
      ),
    }),
  });
  await page.goto("/");
  await startCompare(page);
  await page.getByRole("button", { name: "Split view" }).click();

  await expect(page.locator(".editor-pane-active")).toContainText("Side A");
  await page.getByRole("button", { name: "Monitor B" }).click();
  await expect(page.locator(".editor-pane-active")).toContainText("Side A");
  await expect(page.getByText("Sounding: B (Draft)")).toBeVisible();

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Stop" })).toBeEnabled();
  await expect.poll(() => currentTimeText(page), { timeout: 3000 }).not.toBe("0:00");

  // The monitor remains pinned while the editable pane changes.
  await page.keyboard.press("Alt+b");
  await expect(page.locator(".editor-pane-active")).toContainText("Side B");
  await expect(page.getByText("Sounding: B (Draft)")).toBeVisible();

  // Pinning the opposite side does not move editing, and swaps the running
  // source without hiding or disabling the one shared transport.
  await page.getByRole("button", { name: "Monitor A" }).click();
  await expect(page.locator(".editor-pane-active")).toContainText("Side B");
  await expect(page.getByText("Sounding: A (Current)")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Stop" })).toBeEnabled();
  expect(await currentTimeText(page)).not.toBe("0:00");

  await page.getByRole("button", { name: "Follow editing" }).click();
  await expect(page.getByText("Sounding: B (Draft)")).toBeVisible();
});

test("cross-side solo and current-voice scope use correspondence", async ({ page }) => {
  await installFakeTauri(page, {
    importedProject: project,
    reassign: ({ project: current }) => ({
      ...current,
      notes: current.notes.map((entry) => ({
        ...entry,
        voiceId: entry.id === "a" ? "rerun-lead" : entry.id === "b" ? "rerun-extra" : "rerun-bass",
      })),
      voices: [
        voice("rerun-lead", "Rerun lead", 1, 60, 60),
        voice("rerun-extra", "Rerun extra", 1, 62, 62),
        voice("rerun-bass", "Rerun bass", 1, 64, 64),
      ],
    }),
  });
  await page.goto("/");
  await startCompare(page);
  await page.getByRole("button", { name: "Split view" }).click();

  const matchedSolo = voiceRow(page, "Lead").getByRole("button", { name: "Solo" });
  await matchedSolo.click();
  await page.getByRole("button", { name: "Monitor B" }).click();
  await expect(page.getByText(/Soloed voice has no match/)).toHaveCount(0);

  // A's raw rerun voice id does not exist on B; reaching Pause proves it was
  // mapped to B's corresponding imported voice instead of filtering to empty.
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeEnabled();
  await expect(page.getByText("No notes in scope for soloed voice.")).toHaveCount(0);
  await page.getByRole("button", { name: "Stop" }).click();

  await matchedSolo.click();
  await page.getByLabel("Select notes in Lead", { exact: true }).click();
  await page.getByLabel("Playback scope").selectOption("voice");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeEnabled();
  await expect(page.getByText("No notes in playback scope.")).toHaveCount(0);
  await page.getByRole("button", { name: "Stop" }).click();

  // The split rerun created one extra A voice with no B counterpart. Both
  // voice-scope and solo fall back explicitly instead of trusting raw ids.
  await page.getByLabel("Select notes in Voice 3", { exact: true }).click();
  await expect(page.getByText("Current voice has no match on B.")).toBeVisible();
  await page.getByLabel("Playback scope").selectOption("all");
  await voiceRow(page, "Voice 3").getByRole("button", { name: "Solo" }).click();
  await expect(
    page.getByText("Soloed voice has no match on B; playback will use all voices."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeEnabled();
});

test("split offers an explicit linked/independent pitch-scroll toggle", async ({ page }) => {
  await installFakeTauri(page, {
    importedProject: project,
    reassign: ({ project: current }) => ({
      ...current,
      notes: current.notes.map((entry) =>
        entry.id === "a" ? { ...entry, voiceId: "voice-2" } : entry,
      ),
    }),
  });
  await page.goto("/");
  await startCompare(page);
  await page.getByRole("button", { name: "Split view" }).click();

  // Pitch scroll is independent by default (time is always linked) and flips to
  // linked on click.
  await expect(page.getByRole("button", { name: "Pitch: independent" })).toBeVisible();
  await page.getByRole("button", { name: "Pitch: independent" }).click();
  await expect(page.getByRole("button", { name: "Pitch: linked" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // The toggle is a split-only control -- leaving split hides it.
  await page.getByRole("button", { name: "Single view" }).click();
  await expect(page.getByRole("button", { name: /^Pitch:/ })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Playback monitor" })).toHaveCount(0);
  await expect(page.getByText("Sounding: A (Current)")).toBeVisible();
});
