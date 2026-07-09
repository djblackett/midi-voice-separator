import { expect, test, type Page } from "@playwright/test";
import { buildFixtureProject, installFakeTauri, note, voice } from "./fixtures/tauriMock";

// Smart selection (smartSelect.ts) driven through its real gestures:
// double-click chord select, the right-click context menu's chord/line
// actions, and assign-to-voice swatches. Coordinate math mirrors
// buildViewport/hitTest at default zoom, same as paint-mode.e2e.ts.
const PIANO_ROLL_LABEL_WIDTH = 56;

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

function voiceRow(page: Page, label: string) {
  return page
    .locator(".voice-legend li")
    .filter({ has: page.getByLabel(`Select notes in ${label}`, { exact: true }) });
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
async function canvasBox(page: Page) {
  const canvas = page.locator(".editor-grid canvas").first();
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
});
