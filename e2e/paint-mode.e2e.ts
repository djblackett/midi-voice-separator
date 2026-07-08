import { expect, test, type Page } from "@playwright/test";
import { buildFixtureProject, installFakeTauri, note, voice } from "./fixtures/tauriMock";

// Painting is the one canvas gesture worth reproducing pixel-for-pixel
// (unlike direct-click/marquee selection, covered instead via the
// voice-swatch path in selection-and-reassignment.e2e.ts): it's the only
// way to reach onPaintNotes -> pushHistorySnapshot -> setVoiceOverrides,
// which nothing else exercises. This mirrors buildViewport (drawPianoRoll.ts)
// and the label-gutter offset hitTest.ts applies, at the *default* zoom/pan
// (zoomLevel 1, pan 0) where both visibleTickRange and visiblePitchRange are
// proven identity transforms over the full project span -- see their own
// unit tests. If the app's coordinate math changes, hitTest.test.ts and
// coordinates.test.ts fail first and point here.
const PIANO_ROLL_LABEL_WIDTH = 56;

interface FixtureNote {
  pitch: number;
  startTick: number;
  endTick: number;
}

function noteScreenCenter(
  targetNote: FixtureNote,
  canvasBox: { width: number; height: number },
  durationTicks: number,
  lowestPitch: number,
  highestPitch: number,
) {
  const rollWidth = canvasBox.width - PIANO_ROLL_LABEL_WIDTH;
  const pitchCount = highestPitch - lowestPitch + 1;
  const rowHeight = canvasBox.height / pitchCount;

  const noteX = PIANO_ROLL_LABEL_WIDTH + (targetNote.startTick / durationTicks) * rollWidth;
  const noteEndX = PIANO_ROLL_LABEL_WIDTH + (targetNote.endTick / durationTicks) * rollWidth;
  const noteY = ((highestPitch - targetNote.pitch) / pitchCount) * canvasBox.height;

  return { x: (noteX + noteEndX) / 2, y: noteY + rowHeight / 2 };
}

const noteA: FixtureNote = { pitch: 60, startTick: 0, endTick: 480 };
const noteB: FixtureNote = { pitch: 64, startTick: 480, endTick: 960 };
const noteC: FixtureNote = { pitch: 68, startTick: 960, endTick: 1440 };
const durationTicks = 1440;
const lowestPitch = Math.max(0, noteA.pitch - 2); // 58 -- mirrors computeFullPitchSpan
const highestPitch = Math.min(127, noteC.pitch + 2); // 70

const twoVoiceProject = buildFixtureProject(
  [
    note("a", "voice-1", noteA.pitch, noteA.startTick, { endTick: noteA.endTick }),
    note("b", "voice-1", noteB.pitch, noteB.startTick, { endTick: noteB.endTick }),
    note("c", "voice-2", noteC.pitch, noteC.startTick, { endTick: noteC.endTick }),
  ],
  [voice("voice-1", "Voice 1", 2, 60, 64), voice("voice-2", "Voice 2", 1, 68, 68)],
);

async function importFixture(page: Page) {
  await page.getByRole("button", { name: "Import MIDI" }).click();
  await page.waitForSelector(".voice-legend");
}

// exact: true avoids getByLabel's default substring matching -- a channel
// split names its new voice "<source label> Channel N", a literal
// superstring of the source's own label.
function voiceRow(page: Page, label: string) {
  return page
    .locator(".voice-legend li")
    .filter({ has: page.getByLabel(`Select notes in ${label}`, { exact: true }) });
}

async function clickNoteOnCanvas(page: Page, targetNote: FixtureNote) {
  const canvas = page.locator(".editor-grid canvas");
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error("Piano roll canvas has no bounding box");
  }
  const local = noteScreenCenter(targetNote, box, durationTicks, lowestPitch, highestPitch);
  await page.mouse.move(box.x + local.x, box.y + local.y);
  await page.mouse.down();
  await page.mouse.up();
}

test.describe("paint mode", () => {
  test("toggling paint mode shows a hint naming the brush voice", async ({ page }) => {
    await installFakeTauri(page, { importedProject: twoVoiceProject });
    await page.goto("/");
    await importFixture(page);

    await page.getByLabel("Select notes in Voice 2").click(); // sets activeVoiceId
    await page.getByRole("button", { name: "Paint mode: off" }).click();

    await expect(page.getByRole("button", { name: "Paint mode: on" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator(".piano-roll-toolbar-hint")).toContainText(
      "paint notes into Voice 2",
    );
  });

  test("a number key while in paint mode changes the brush voice, not the selection", async ({
    page,
  }) => {
    await installFakeTauri(page, { importedProject: twoVoiceProject });
    await page.goto("/");
    await importFixture(page);

    await page.getByRole("button", { name: "Paint mode: off" }).click();
    await page.keyboard.press("1");

    await expect(page.locator(".piano-roll-toolbar-hint")).toContainText(
      "paint notes into Voice 1",
    );
    // No note actually moved -- pressing a brush-select number key must not
    // reassign anything by itself.
    await expect(voiceRow(page, "Voice 1")).toContainText("2 notes");
    await expect(voiceRow(page, "Voice 2")).toContainText("1 notes");
  });

  test("clicking a note on the canvas while painting reassigns it, as one undoable step", async ({
    page,
  }) => {
    await installFakeTauri(page, { importedProject: twoVoiceProject });
    await page.goto("/");
    await importFixture(page);

    await page.getByLabel("Select notes in Voice 2").click();
    await page.getByRole("button", { name: "Paint mode: off" }).click();

    await clickNoteOnCanvas(page, noteA);

    await expect(voiceRow(page, "Voice 1")).toContainText("1 notes");
    await expect(voiceRow(page, "Voice 2")).toContainText("2 notes");

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(voiceRow(page, "Voice 1")).toContainText("2 notes");
    await expect(voiceRow(page, "Voice 2")).toContainText("1 notes");
  });
});
