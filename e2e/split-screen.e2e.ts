import { expect, test, type Page } from "@playwright/test";
import { buildFixtureProject, installFakeTauri, note, voice } from "./fixtures/tauriMock";

const project = buildFixtureProject(
  [note("a", "voice-1", 60, 0), note("b", "voice-1", 62, 120), note("c", "voice-2", 64, 240)],
  [voice("voice-1", "Lead", 2, 60, 62), voice("voice-2", "Bass", 1, 64, 64)],
);

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
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
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
});
