import { expect, test, type Page } from "@playwright/test";
import { buildFixtureProject, installFakeTauri, note, voice } from "./fixtures/tauriMock";

// Confidence heatmap + audition toggles. The heatmap assertion samples a
// real canvas pixel (the one rendering surface these features change), so
// it verifies actual recoloring, not just button state.
const PIANO_ROLL_LABEL_WIDTH = 56;

const lowNote = { pitch: 60, startTick: 0, endTick: 960 };
const sureNote = { pitch: 72, startTick: 960, endTick: 1920 };
const durationTicks = 1920;
const lowestPitch = 58; // mirrors computeFullPitchSpan
const highestPitch = 74;

const fixtureProject = buildFixtureProject(
  [
    note("low", "voice-1", lowNote.pitch, lowNote.startTick, {
      endTick: lowNote.endTick,
      assignmentConfidence: 0.1,
    }),
    note("sure", "voice-1", sureNote.pitch, sureNote.startTick, {
      endTick: sureNote.endTick,
      assignmentConfidence: 1,
    }),
  ],
  [voice("voice-1", "Voice 1", 2, 60, 72)],
);

async function importFixture(page: Page) {
  await installFakeTauri(page, { importedProject: fixtureProject });
  await page.goto("/");
  await page.getByRole("button", { name: "Import MIDI" }).click();
  await page.waitForSelector(".voice-legend");
}

async function canvasBox(page: Page) {
  const canvas = page.getByLabel("Piano roll note visualization");
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error("Piano roll canvas has no bounding box");
  }
  return box;
}

function noteScreenCenter(
  targetNote: { pitch: number; startTick: number; endTick: number },
  box: { width: number; height: number },
) {
  const rollWidth = box.width - PIANO_ROLL_LABEL_WIDTH;
  const pitchCount = highestPitch - lowestPitch + 1;
  const rowHeight = box.height / pitchCount;
  const x =
    PIANO_ROLL_LABEL_WIDTH +
    ((targetNote.startTick + targetNote.endTick) / 2 / durationTicks) * rollWidth;
  const y = ((highestPitch - targetNote.pitch) / pitchCount) * box.height + rowHeight / 2;
  return { x, y };
}

/** RGB of the rendered canvas pixel at canvas-local (x, y). */
async function pixelAt(page: Page, x: number, y: number): Promise<[number, number, number]> {
  return page.evaluate(
    ([localX, localY]) => {
      const canvas = document.querySelector<HTMLCanvasElement>("canvas[aria-label=\"Piano roll note visualization\"]");
      const context = canvas?.getContext("2d");
      if (!canvas || !context) {
        throw new Error("No piano roll canvas context");
      }
      const ratio = window.devicePixelRatio || 1;
      const data = context.getImageData(
        Math.round(localX * ratio),
        Math.round(localY * ratio),
        1,
        1,
      ).data;
      return [data[0], data[1], data[2]] as [number, number, number];
    },
    [x, y],
  );
}

test.describe("confidence heatmap", () => {
  test("toggling heat recolors a low-confidence note from voice blue to red", async ({ page }) => {
    await importFixture(page);
    const box = await canvasBox(page);
    const { x, y } = noteScreenCenter(lowNote, box);

    // Voice 1's fill is #38bdf8 — blue dominates.
    const [rOff, , bOff] = await pixelAt(page, x, y);
    expect(bOff).toBeGreaterThan(rOff);

    await page.getByRole("button", { name: "Confidence heat: off" }).click();
    await expect(page.getByRole("button", { name: "Confidence heat: on" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator(".confidence-heat-legend")).toBeVisible();

    // Confidence 0.1 lands near the red end of the scale.
    const [rOn, gOn, bOn] = await pixelAt(page, x, y);
    expect(rOn).toBeGreaterThan(gOn);
    expect(rOn).toBeGreaterThan(bOn);

    // A fully confident note sits at the green end.
    const sure = noteScreenCenter(sureNote, box);
    const [rSure, gSure] = await pixelAt(page, sure.x, sure.y);
    expect(gSure).toBeGreaterThan(rSure);
  });

  test("the H key toggles heat view", async ({ page }) => {
    await importFixture(page);

    await page.keyboard.press("h");
    await expect(page.getByRole("button", { name: "Confidence heat: on" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.keyboard.press("h");
    await expect(page.getByRole("button", { name: "Confidence heat: off" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});

test.describe("audition", () => {
  test("clicking a note with audition on plays without errors, and the toggle flips", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));

    await importFixture(page);

    // Default on; clicking a note fires a real Web Audio blip.
    await expect(page.getByRole("button", { name: "Audition: on" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const box = await canvasBox(page);
    const { x, y } = noteScreenCenter(lowNote, box);
    await page.mouse.click(box.x + x, box.y + y);
    await expect(page.getByLabel("Selected note details")).toBeVisible(); // note got selected

    await page.getByRole("button", { name: "Audition: on" }).click();
    await expect(page.getByRole("button", { name: "Audition: off" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    expect(pageErrors).toEqual([]);
  });
});
