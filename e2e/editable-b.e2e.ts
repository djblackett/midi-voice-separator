import { expect, test, type Page } from "@playwright/test";
import { buildFixtureProject, installFakeTauri, note, voice } from "./fixtures/tauriMock";

// Side B is a live editable branch forked from an immutable snapshot. This
// suite drives the real A/B toggle to prove the two sides edit and undo
// independently and that neither touches the other. Reassignment is driven
// through the voice-swatch selection path (see selection-and-reassignment.e2e).
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

function voiceRow(page: Page, label: string) {
  return page
    .locator(".voice-legend li")
    .filter({ has: page.getByLabel(`Select notes in ${label}`, { exact: true }) });
}

function statsRow(page: Page, label: string) {
  return page.locator(".diff-summary-stats div", { hasText: label }).innerText();
}

test("editing side B leaves side A untouched, with independent per-side undo", async ({ page }) => {
  await installFakeTauri(page, {
    importedProject: project,
    // Re-run moves note a from Lead to Bass, so current (A) diverges from the
    // import snapshot that side B is forked from.
    reassign: ({ project: current }) => ({
      ...current,
      notes: current.notes.map((entry) =>
        entry.id === "a" ? { ...entry, voiceId: "voice-2" } : entry,
      ),
    }),
  });
  await page.goto("/");
  await startCompare(page);

  // Side A (active after starting): re-run left Lead with 1 note and Bass with 2.
  await expect(voiceRow(page, "Lead")).toContainText("1 notes");
  await expect(voiceRow(page, "Bass")).toContainText("2 notes");

  // Side B is the forked snapshot: Lead still has 2 notes, Bass 1.
  await page.getByRole("button", { name: "B: Draft" }).click();
  await expect(voiceRow(page, "Lead")).toContainText("2 notes");
  await expect(voiceRow(page, "Bass")).toContainText("1 notes");

  // Edit B: move Lead's notes to Bass. B now has Lead 0, Bass 3.
  await page.getByLabel("Select notes in Lead").click();
  await page.keyboard.press("2");
  await expect(voiceRow(page, "Lead")).toContainText("0 notes");
  await expect(voiceRow(page, "Bass")).toContainText("3 notes");

  // Back on A: B's edit did not touch A.
  await page.getByRole("button", { name: "A: Current" }).click();
  await expect(voiceRow(page, "Lead")).toContainText("1 notes");
  await expect(voiceRow(page, "Bass")).toContainText("2 notes");

  // Undo on A reverts only A (undoes the re-run's move, back to the import split).
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(voiceRow(page, "Lead")).toContainText("2 notes");
  await expect(voiceRow(page, "Bass")).toContainText("1 notes");

  // B still holds its own edit -- A's undo left it alone.
  await page.getByRole("button", { name: "B: Draft" }).click();
  await expect(voiceRow(page, "Lead")).toContainText("0 notes");
  await expect(voiceRow(page, "Bass")).toContainText("3 notes");
});

test("the diff reflects edits to the live B branch, not the frozen snapshot", async ({ page }) => {
  await installFakeTauri(page, {
    importedProject: project,
    // Re-run moves the Bass note (c) into Lead, so A becomes all-Lead while the
    // forked B snapshot keeps its Lead/Bass split -- the two sides differ.
    reassign: ({ project: current }) => ({
      ...current,
      notes: current.notes.map((entry) =>
        entry.id === "c" ? { ...entry, voiceId: "voice-1" } : entry,
      ),
    }),
  });
  await page.goto("/");
  await startCompare(page);

  // A (all Lead) vs the just-forked B (Lead a,b / Bass c): the Bass note differs.
  await expect.poll(() => statsRow(page, "Notes reassigned")).toContain("1");

  // Edit B to match A: move its Bass note into Lead so B is now all-Lead too.
  await page.getByRole("button", { name: "B: Draft" }).click();
  await page.getByLabel("Select notes in Bass").click();
  await page.keyboard.press("1");

  // Back on A, the diff re-derives against the edited B branch and now finds no
  // difference. A frozen-snapshot reference would still report the one change.
  await page.getByRole("button", { name: "A: Current" }).click();
  await expect.poll(() => statsRow(page, "Notes reassigned")).toContain("0");
});

test("Use B promotes the B draft to the working result and keeps A as a snapshot", async ({
  page,
}) => {
  await installFakeTauri(page, {
    importedProject: project,
    // A becomes all-Lead on re-run; the forked B keeps the Lead/Bass split.
    reassign: ({ project: current }) => ({
      ...current,
      notes: current.notes.map((entry) =>
        entry.id === "c" ? { ...entry, voiceId: "voice-1" } : entry,
      ),
    }),
  });
  await page.goto("/");
  await startCompare(page);

  // A (active) is all-Lead after the re-run.
  await expect(voiceRow(page, "Lead")).toContainText("3 notes");

  await page.getByRole("button", { name: "Use B" }).click();

  // The comparison closes and the working result is now B's Lead/Bass split.
  await expect(page.getByRole("button", { name: "A: Current" })).toHaveCount(0);
  await expect(voiceRow(page, "Lead")).toContainText("2 notes");
  await expect(voiceRow(page, "Bass")).toContainText("1 notes");
  // A was preserved as a named snapshot before B overwrote it.
  await expect(page.getByLabel("Rename snapshot A before using B")).toHaveCount(1);
});

test("exiting with unsaved B edits requires confirmation", async ({ page }) => {
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

  // Edit side B so it becomes dirty.
  await page.getByRole("button", { name: "B: Draft" }).click();
  await page.getByLabel("Select notes in Lead").click();
  await page.keyboard.press("2");

  // Exiting now asks first rather than silently dropping the edits.
  await page.getByRole("button", { name: "Exit compare" }).click();
  await expect(page.getByText("Discard side B")).toBeVisible();

  // Cancel keeps the comparison open with B intact.
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "A: Current" })).toBeVisible();
  await expect(voiceRow(page, "Bass")).toContainText("3 notes");

  // Confirming the discard exits the comparison.
  await page.getByRole("button", { name: "Exit compare" }).click();
  await page.getByRole("button", { name: "Discard B" }).click();
  await expect(page.getByRole("button", { name: "A: Current" })).toHaveCount(0);
});
