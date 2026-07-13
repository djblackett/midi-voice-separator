import { expect, test, type Locator, type Page } from "@playwright/test";
import { buildFixtureProject, installFakeTauri, note, voice } from "./fixtures/tauriMock";

const project = buildFixtureProject(
  [note("a", "voice-1", 60, 0), note("b", "voice-1", 62, 120), note("c", "voice-2", 64, 240)],
  [voice("voice-1", "Lead", 2, 60, 62), voice("voice-2", "Bass", 1, 64, 64)],
  { durationTicks: 3840 },
);

const denseSplitVoiceCount = 32;
const denseSplitVoices = Array.from({ length: denseSplitVoiceCount }, (_, index) =>
  voice(`import-${index + 1}`, `Import voice ${index + 1}`, 1, 48 + index, 48 + index),
);
const denseSplitProject = buildFixtureProject(
  denseSplitVoices.map((candidate, index) =>
    note(`dense-${index + 1}`, candidate.id, 48 + index, index * 48),
  ),
  denseSplitVoices,
  { fileName: "dense-split.mid", durationTicks: 3840 },
);

function denseRerunProject(current: typeof denseSplitProject) {
  const notes = current.notes
    .filter((entry) => entry.id !== "dense-3")
    .map((entry) => {
      const number = Number.parseInt(entry.id.replace("dense-", ""), 10);
      return { ...entry, voiceId: `rerun-${number}` };
    });
  const voices = notes.map((entry) => {
    const number = Number.parseInt(entry.id.replace("dense-", ""), 10);
    return voice(entry.voiceId, `Rerun voice ${number}`, 1, entry.pitch, entry.pitch);
  });
  return {
    ...current,
    notes,
    voices,
    separationSummary: {
      ...current.separationSummary,
      voiceCount: voices.length,
    },
  };
}

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

async function startDenseCompare(page: Page) {
  await page.getByRole("button", { name: "Import MIDI" }).click();
  await page.waitForSelector(".diff-summary");
  await page.getByRole("button", { name: "Re-run separation" }).click();

  // Reconciliation preserves import order, so deliberately move A's voice 31
  // near the top while the immutable import snapshot on B keeps it near the
  // bottom. Linked navigation must use correspondence, not pixels or raw ids.
  const moveVoice31Up = page.getByLabel("Move Import voice 31 up", {
    exact: true,
  });
  for (let move = 0; move < 28; move += 1) {
    await moveVoice31Up.click();
  }

  const importValue = await page
    .locator(".diff-target-select option", { hasText: "Import" })
    .getAttribute("value");
  await page.locator(".diff-target-select").selectOption(importValue ?? "");
  await page.getByRole("button", { name: "Start A/B compare" }).click();
}

async function setRangeValue(slider: Locator, value: number) {
  await slider.fill(String(value));
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
  const sideAEditing = page.getByRole("group", {
    name: "Side A piano roll (editing)",
    exact: true,
  });
  const sideB = page.getByRole("group", { name: "Side B piano roll", exact: true });
  await expect(sideAEditing).toBeVisible();
  await expect(sideB).toBeVisible();
  await expect(
    sideAEditing.getByLabel("Side A piano roll note visualization", { exact: true }),
  ).toBeVisible();
  await expect(
    sideB.getByLabel("Side B piano roll note visualization", { exact: true }),
  ).toBeVisible();

  // Side A is the active (editable) side by default.
  await expect(page.locator(".editor-pane-active")).toContainText("Side A");

  // Clicking the Side B pane makes B the active side.
  await sideB.click();
  await expect(page.locator(".editor-pane-active")).toContainText("Side B");
  await expect(page.getByRole("group", { name: "Side A piano roll", exact: true })).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Side B piano roll (editing)", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Side A piano roll note visualization", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Side B piano roll note visualization", { exact: true }),
  ).toBeVisible();
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
  // a view-aware lane label without changing the preference.
  await expect(page.getByRole("button", { name: "Pitch: independent" })).toBeVisible();
  await page.getByRole("button", { name: "Voice lanes" }).click();
  await expect(page.getByRole("button", { name: "Lanes: independent" })).toBeVisible();
  await page.getByRole("button", { name: "Lanes: independent" }).click();
  await expect(page.getByRole("button", { name: "Lanes: linked" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Piano roll" }).click();
  await expect(page.getByRole("button", { name: "Pitch: linked" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // The toggle is a split-only control -- leaving split hides it.
  await page.getByRole("button", { name: "Single view" }).click();
  await expect(page.getByRole("button", { name: /^(Pitch|Lanes):/ })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Playback monitor" })).toHaveCount(0);
  await expect(page.getByText("Sounding: A (Current)")).toBeVisible();
});

test("a split voice-lane edit mutates only active B and keeps undo branch-local", async ({
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
  await page.getByRole("button", { name: "Voice lanes" }).click();

  const sideAEditing = page.getByRole("group", {
    name: "Side A voice lane (editing)",
    exact: true,
  });
  const sideB = page.getByRole("group", { name: "Side B voice lane", exact: true });
  const sideACanvas = sideAEditing.getByLabel("Side A voice lane note visualization", {
    exact: true,
  });
  const sideBCanvas = sideB.getByLabel("Side B voice lane note visualization", { exact: true });
  await expect(sideACanvas).toBeVisible();
  await expect(sideBCanvas).toBeVisible();

  const initialSideAHeight = (await sideACanvas.boundingBox())?.height ?? 0;
  const initialSideBHeight = (await sideBCanvas.boundingBox())?.height ?? 0;
  await page.getByRole("button", { name: "Fullscreen workspace" }).click();
  await expect(page.getByRole("button", { name: "Exit fullscreen" })).toBeVisible();
  await expect
    .poll(async () => (await sideACanvas.boundingBox())?.height ?? 0)
    .toBeGreaterThan(initialSideAHeight);
  await expect
    .poll(async () => (await sideBCanvas.boundingBox())?.height ?? 0)
    .toBeGreaterThan(initialSideBHeight);
  await expect(
    sideAEditing.getByRole("slider", { name: "Voice lane vertical scroll" }),
  ).toBeVisible();
  await expect(sideB.getByRole("slider", { name: "Voice lane vertical scroll" })).toBeVisible();

  // A is the re-run: note a moved from Lead to Bass.
  await expect(voiceRow(page, "Lead")).toContainText("1 notes");
  await expect(voiceRow(page, "Bass")).toContainText("2 notes");

  // Activate B. Its branch starts at the import split with no undo history.
  await sideB.click();
  await expect(
    page.getByRole("group", { name: "Side B voice lane (editing)", exact: true }),
  ).toBeVisible();
  await expect(voiceRow(page, "Lead")).toContainText("2 notes");
  await expect(voiceRow(page, "Bass")).toContainText("1 notes");
  const undo = page.getByRole("button", { name: "Undo" });
  await expect(undo).toBeDisabled();

  // One lane-view assignment mutates B and creates exactly one B history entry.
  await page.getByLabel("Select notes in Lead", { exact: true }).click();
  await page.keyboard.press("2");
  await expect(voiceRow(page, "Lead")).toContainText("0 notes");
  await expect(voiceRow(page, "Bass")).toContainText("3 notes");
  await expect(undo).toBeEnabled();

  // A kept its own re-run result while B was edited.
  await page.getByRole("group", { name: "Side A voice lane", exact: true }).click();
  await expect(voiceRow(page, "Lead")).toContainText("1 notes");
  await expect(voiceRow(page, "Bass")).toContainText("2 notes");

  // Undoing once on B restores its baseline and exhausts only B's history.
  await page.getByRole("group", { name: "Side B voice lane", exact: true }).click();
  await expect(voiceRow(page, "Lead")).toContainText("0 notes");
  await expect(voiceRow(page, "Bass")).toContainText("3 notes");
  await undo.click();
  await expect(voiceRow(page, "Lead")).toContainText("2 notes");
  await expect(voiceRow(page, "Bass")).toContainText("1 notes");
  await expect(undo).toBeDisabled();

  await page.getByRole("group", { name: "Side A voice lane", exact: true }).click();
  await expect(voiceRow(page, "Lead")).toContainText("1 notes");
  await expect(voiceRow(page, "Bass")).toContainText("2 notes");
  await expect(undo).toBeEnabled();
});

test("split lane navigation stays independent or links by strict voice correspondence", async ({
  page,
}) => {
  await installFakeTauri(page, {
    importedProject: denseSplitProject,
    reassign: ({ project: current }) => denseRerunProject(current),
  });
  await page.goto("/");
  await startDenseCompare(page);
  await page.getByRole("button", { name: "Split view" }).click();
  await page.getByRole("button", { name: "Voice lanes" }).click();

  const sideA = page.getByRole("group", {
    name: "Side A voice lane (editing)",
    exact: true,
  });
  const sideB = page.getByRole("group", { name: "Side B voice lane", exact: true });
  await expect(
    sideA.getByLabel("Side A voice lane note visualization", { exact: true }),
  ).toBeVisible();
  await expect(
    sideB.getByLabel("Side B voice lane note visualization", { exact: true }),
  ).toBeVisible();
  const sideASlider = sideA.getByRole("slider", {
    name: "Voice lane vertical scroll",
  });
  const sideBSlider = sideB.getByRole("slider", {
    name: "Voice lane vertical scroll",
  });
  await expect(sideASlider).toBeEnabled();
  await expect(sideBSlider).toBeEnabled();
  await expect.poll(async () => Number(await sideASlider.getAttribute("max"))).toBeGreaterThan(0);
  await expect.poll(async () => Number(await sideBSlider.getAttribute("max"))).toBeGreaterThan(0);
  await expect(page.locator(".editor-pane-active")).toContainText("Side A");

  // Independent is the default: moving A does not copy its pixels into B.
  await setRangeValue(sideASlider, 36);
  await expect(sideASlider).toHaveValue("36");
  await expect(sideBSlider).toHaveValue("0");

  await page.getByRole("button", { name: "Lanes: independent" }).click();
  await setRangeValue(sideASlider, 37);
  await expect(sideASlider).toHaveValue("37");
  await expect.poll(async () => Number(await sideBSlider.inputValue())).toBeGreaterThan(0);
  expect(Number(await sideBSlider.inputValue())).not.toBe(37);

  // Import voice 3 has no A-side counterpart. Navigating the still-read-only
  // B scrollbar leaves A untouched and reports the explicit fallback.
  await setRangeValue(sideBSlider, 72);
  await expect(sideBSlider).toHaveValue("72");
  await expect(sideASlider).toHaveValue("37");
  await expect(
    page.getByText("No matched lane on side A; that pane stayed independent."),
  ).toBeVisible();
  await expect(page.locator(".editor-pane-active")).toContainText("Side A");

  // A matched B anchor links back to A without activating the read-only pane.
  await sideBSlider.focus();
  await sideBSlider.press("Home");
  await expect(sideBSlider).toHaveValue("0");
  await expect(sideASlider).toHaveValue("0");
  await expect(page.locator(".lane-link-status")).toHaveCount(0);
  await expect(page.locator(".editor-pane-active")).toContainText("Side A");

  // A new request id lets the same semantic target be revealed again.
  await setRangeValue(sideASlider, 36);
  await expect.poll(async () => Number(await sideBSlider.inputValue())).toBeGreaterThan(0);
});
