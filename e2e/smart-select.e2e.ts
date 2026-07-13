import { expect, test, type Page } from "@playwright/test";
import { buildFixtureProject, installFakeTauri, note, voice } from "./fixtures/tauriMock";

// Smart selection (smartSelect.ts) driven through its real gestures:
// double-click chord select, the right-click context menu's chord/line
// actions, and assign-to-voice swatches. Coordinate math mirrors the
// canonical piano and voice-lane rectangles at default zoom.
const PIANO_ROLL_LABEL_WIDTH = 56;
const VOICE_LANE_LABEL_WIDTH = 96;
const LANE_PADDING_Y = 6;
const MIN_NOTE_HEIGHT = 5;
const MAX_NOTE_HEIGHT = 12;

interface FixtureNote {
  pitch: number;
  startTick: number;
  endTick: number;
}

// A block chord (0-480), then a separated three-note run (1440-2880 —
// the 960-tick silence exceeds the wand/phrase one-beat gap limit), plus
// a high Voice 2 note out of everything's reach.
const chordRoot: FixtureNote = { pitch: 60, startTick: 0, endTick: 480 };
const chordThird: FixtureNote = { pitch: 64, startTick: 0, endTick: 480 };
const chordFifth: FixtureNote = { pitch: 67, startTick: 0, endTick: 480 };
const run1: FixtureNote = { pitch: 60, startTick: 1440, endTick: 1920 };
const run2: FixtureNote = { pitch: 62, startTick: 1920, endTick: 2400 };
const run3: FixtureNote = { pitch: 64, startTick: 2400, endTick: 2880 };
const high: FixtureNote = { pitch: 76, startTick: 1440, endTick: 1920 };

const durationTicks = 2880;
const lowestPitch = Math.max(0, 60 - 2); // mirrors computeFullPitchSpan
const highestPitch = Math.min(127, 76 + 2);

const fixtureProject = buildFixtureProject(
  [
    note("chord-root", "voice-1", chordRoot.pitch, chordRoot.startTick, {
      endTick: chordRoot.endTick,
    }),
    note("chord-third", "voice-1", chordThird.pitch, chordThird.startTick, {
      endTick: chordThird.endTick,
    }),
    note("chord-fifth", "voice-1", chordFifth.pitch, chordFifth.startTick, {
      endTick: chordFifth.endTick,
    }),
    note("run-1", "voice-1", run1.pitch, run1.startTick, { endTick: run1.endTick }),
    note("run-2", "voice-1", run2.pitch, run2.startTick, { endTick: run2.endTick }),
    note("run-3", "voice-1", run3.pitch, run3.startTick, { endTick: run3.endTick }),
    note("high", "voice-2", high.pitch, high.startTick, { endTick: high.endTick }),
  ],
  [voice("voice-1", "Voice 1", 6, 60, 67), voice("voice-2", "Voice 2", 1, 76, 76)],
);

function noteScreenCenter(targetNote: FixtureNote, canvasBox: { width: number; height: number }) {
  const rollWidth = canvasBox.width - PIANO_ROLL_LABEL_WIDTH;
  const pitchCount = highestPitch - lowestPitch + 1;
  const rowHeight = canvasBox.height / pitchCount;

  const noteX = PIANO_ROLL_LABEL_WIDTH + (targetNote.startTick / durationTicks) * rollWidth;
  const noteEndX = PIANO_ROLL_LABEL_WIDTH + (targetNote.endTick / durationTicks) * rollWidth;
  const noteY = ((highestPitch - targetNote.pitch) / pitchCount) * canvasBox.height;

  return { x: (noteX + noteEndX) / 2, y: noteY + rowHeight / 2 };
}

function laneNoteScreenCenter(
  targetNote: FixtureNote,
  canvasBox: { width: number; height: number },
  voiceIndex: number,
  lowestVoicePitch: number,
  highestVoicePitch: number,
) {
  const laneHeight = Math.max(36, canvasBox.height / fixtureProject.voices.length);
  const innerHeight = Math.max(1, laneHeight - LANE_PADDING_Y * 2);
  const pitchSpan = Math.max(1, highestVoicePitch - lowestVoicePitch + 1);
  const noteHeight = Math.min(MAX_NOTE_HEIGHT, Math.max(MIN_NOTE_HEIGHT, innerHeight / pitchSpan));
  const pitchOffset =
    ((highestVoicePitch - targetNote.pitch) / pitchSpan) * Math.max(1, innerHeight - noteHeight);
  const rollWidth = canvasBox.width - VOICE_LANE_LABEL_WIDTH;
  const noteX = VOICE_LANE_LABEL_WIDTH + (targetNote.startTick / durationTicks) * rollWidth;
  const noteEndX = VOICE_LANE_LABEL_WIDTH + (targetNote.endTick / durationTicks) * rollWidth;

  return {
    x: (noteX + noteEndX) / 2,
    y: voiceIndex * laneHeight + LANE_PADDING_Y + pitchOffset + noteHeight / 2,
  };
}

function voiceRow(page: Page, label: string) {
  return page
    .locator(".voice-legend li")
    .filter({ has: page.getByLabel(`Select notes in ${label}`, { exact: true }) });
}

function statsRow(page: Page, label: string) {
  return page.locator(".diff-summary-stats div", { hasText: label }).innerText();
}

async function importFixture(page: Page) {
  await installFakeTauri(page, { importedProject: fixtureProject });
  await page.goto("/");
  await page.getByRole("button", { name: "Import MIDI" }).click();
  await page.waitForSelector(".voice-legend");
}

// Re-resolved before every canvas gesture rather than cached per test:
// any intervening locator click (voice swatch, Undo, menu item) may
// auto-scroll the page and shift the canvas, and raw page.mouse events
// use absolute viewport coordinates.
async function canvasBox(page: Page, label = "Piano roll note visualization") {
  const canvas = page.getByLabel(label, { exact: true });
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error("Piano roll canvas has no bounding box");
  }
  return box;
}

async function rightClickNote(page: Page, target: FixtureNote) {
  const box = await canvasBox(page);
  const local = noteScreenCenter(target, box);
  await page.mouse.click(box.x + local.x, box.y + local.y, { button: "right" });
}

async function switchToVoiceLanes(page: Page) {
  await page.getByRole("button", { name: "Voice lanes" }).click();
  await expect(page.getByRole("button", { name: "Voice lanes" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
}

async function laneNotePoint(
  page: Page,
  target: FixtureNote,
  voiceIndex: number,
  lowestVoicePitch: number,
  highestVoicePitch: number,
) {
  const label = "Voice lane note visualization";
  const canvas = page.getByLabel(label, { exact: true });
  const box = await canvasBox(page, label);
  return {
    canvas,
    point: laneNoteScreenCenter(target, box, voiceIndex, lowestVoicePitch, highestVoicePitch),
  };
}

async function rightClickLaneNote(
  page: Page,
  target: FixtureNote,
  voiceIndex: number,
  lowestVoicePitch: number,
  highestVoicePitch: number,
) {
  const { canvas, point } = await laneNotePoint(
    page,
    target,
    voiceIndex,
    lowestVoicePitch,
    highestVoicePitch,
  );
  await canvas.click({ position: point, button: "right" });
}

test.describe("smart selection", () => {
  test("double-clicking a note selects its whole chord", async ({ page }) => {
    await importFixture(page);

    const box = await canvasBox(page);
    const local = noteScreenCenter(chordThird, box);
    await page.mouse.dblclick(box.x + local.x, box.y + local.y);

    await expect(page.getByText(/3 notes selected/)).toBeVisible();
  });

  test("context menu selects a chord, then assigns the selection to a voice", async ({ page }) => {
    await importFixture(page);

    await rightClickNote(page, chordRoot);
    await page.getByRole("menuitem", { name: "Select chord" }).click();
    await expect(page.getByText(/3 notes selected/)).toBeVisible();

    // Right-click a *selected* note: the assign action targets the whole
    // selection, not just the clicked note.
    await rightClickNote(page, chordRoot);
    await page.getByRole("menuitem", { name: "Assign to Voice 2" }).click();

    await expect(voiceRow(page, "Voice 1")).toContainText("3 notes");
    await expect(voiceRow(page, "Voice 2")).toContainText("4 notes");

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(voiceRow(page, "Voice 1")).toContainText("6 notes");
    await expect(voiceRow(page, "Voice 2")).toContainText("1 notes");
  });

  test("context menu assigns just the clicked note when it isn't selected", async ({ page }) => {
    await importFixture(page);

    await rightClickNote(page, run1);
    await page.getByRole("menuitem", { name: "Assign to Voice 2" }).click();

    await expect(voiceRow(page, "Voice 1")).toContainText("5 notes");
    await expect(voiceRow(page, "Voice 2")).toContainText("2 notes");
  });

  test("keep top line only reduces the selection to the skyline", async ({ page }) => {
    await importFixture(page);

    // Select all six Voice 1 notes (chord + run) via the swatch.
    await page.getByLabel("Select notes in Voice 1", { exact: true }).click();
    await expect(page.getByText(/6 notes selected/)).toBeVisible();

    await rightClickNote(page, chordFifth);
    await page.getByRole("menuitem", { name: "Keep top line only" }).click();

    // The chord collapses to its highest note; the run notes never
    // overlap anything, so all three survive: 4 notes.
    await expect(page.getByText(/4 notes selected/)).toBeVisible();
  });

  test("voice lanes double-click a chord and assign the selected chord from its context menu", async ({
    page,
  }) => {
    await importFixture(page);
    await switchToVoiceLanes(page);

    const { canvas, point } = await laneNotePoint(page, chordThird, 0, 60, 67);
    await canvas.dblclick({ position: point });
    await expect(page.getByLabel("Selected note details")).toContainText("3 notes selected");

    await rightClickLaneNote(page, chordRoot, 0, 60, 67);
    await page.getByRole("menuitem", { name: "Assign to Voice 2" }).click();
    await expect(voiceRow(page, "Voice 1")).toContainText("3 notes");
    await expect(voiceRow(page, "Voice 2")).toContainText("4 notes");

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(voiceRow(page, "Voice 1")).toContainText("6 notes");
    await expect(voiceRow(page, "Voice 2")).toContainText("1 notes");
  });

  test("voice lane context actions select phrases, keep a line, and target an unselected note", async ({
    page,
  }) => {
    await importFixture(page);
    await switchToVoiceLanes(page);

    await rightClickLaneNote(page, run2, 0, 60, 67);
    await page.getByRole("menuitem", { name: "Select phrase" }).click();
    await expect(page.getByLabel("Selected note details")).toContainText("3 notes selected");

    await rightClickLaneNote(page, chordRoot, 0, 60, 67);
    await page.getByRole("menuitem", { name: "Select chord" }).click();
    await rightClickLaneNote(page, chordFifth, 0, 60, 67);
    await page.getByRole("menuitem", { name: "Keep bottom line only" }).click();
    await expect(page.getByLabel("Selected note details").locator("dl")).toContainText("60");

    await rightClickLaneNote(page, run1, 0, 60, 67);
    await page.getByRole("menuitem", { name: "Assign to Voice 2" }).click();
    await expect(voiceRow(page, "Voice 1")).toContainText("5 notes");
    await expect(voiceRow(page, "Voice 2")).toContainText("2 notes");
  });

  test("filtered voice-lane context assignment cannot mutate hidden selected notes", async ({
    page,
  }) => {
    await installFakeTauri(page, {
      importedProject: fixtureProject,
      reassign: ({ project: current }) => ({
        ...current,
        notes: current.notes.map((entry) =>
          entry.id === "chord-root" ? { ...entry, voiceId: "voice-2" } : entry,
        ),
      }),
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Import MIDI" }).click();
    await page.waitForSelector(".diff-summary");
    await page.getByRole("button", { name: "Re-run separation" }).click();
    const importValue = await page
      .locator(".diff-target-select option", { hasText: "Import" })
      .getAttribute("value");
    await page.locator(".diff-target-select").selectOption(importValue ?? "");
    await expect.poll(() => statsRow(page, "Notes reassigned")).toContain("1");

    await page.getByLabel("Select notes in Voice 2", { exact: true }).click();
    await page.getByLabel("Show changes in piano roll").check();
    await page.getByLabel("Only changed notes").check();
    await switchToVoiceLanes(page);

    await rightClickLaneNote(page, chordRoot, 1, 60, 76);
    await page.getByRole("menuitem", { name: "Assign to Voice 1" }).click();
    await expect(voiceRow(page, "Voice 1")).toContainText("6 notes");
    await expect(voiceRow(page, "Voice 2")).toContainText("1 notes");
  });
});
