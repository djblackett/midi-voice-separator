import { expect, test, type Page } from "@playwright/test";
import { buildFixtureProject, installFakeTauri, note, voice } from "./fixtures/tauriMock";

const PIANO_ROLL_LABEL_WIDTH = 56;

const conflictProject = buildFixtureProject(
  [
    note("a", "voice-1", 60, 0, { endTick: 600, durationTicks: 600 }),
    note("b", "voice-1", 64, 480, { endTick: 900, durationTicks: 420 }),
    note("c", "voice-2", 72, 120, { endTick: 360, durationTicks: 240 }),
  ],
  [voice("voice-1", "Lead", 2, 60, 64), voice("voice-2", "Bass", 1, 72, 72)],
  { durationTicks: 960 },
);

const rangeProject = buildFixtureProject(
  [
    note("before", "voice-1", 60, 0, { endTick: 240, durationTicks: 240 }),
    note("inside", "voice-1", 62, 300, { endTick: 500, durationTicks: 200 }),
    note("straddling", "voice-2", 64, 450, { endTick: 800, durationTicks: 350 }),
    note("after", "voice-2", 67, 820, { endTick: 960, durationTicks: 140 }),
  ],
  [voice("voice-1", "Bass", 2, 60, 62), voice("voice-2", "Lead", 2, 64, 67)],
  { durationTicks: 960 },
);

async function importFixture(page: Page) {
  await page.getByRole("button", { name: "Import MIDI" }).click();
  await page.waitForSelector(".piano-roll-toolbar");
}

async function rulerPosition(page: Page, tick: number, durationTicks: number) {
  const ruler = page.locator(".piano-roll-time-ruler");
  await expect(ruler).toBeVisible();
  const box = await ruler.boundingBox();
  if (!box) {
    throw new Error("Time ruler has no bounding box");
  }
  const rollWidth = box.width - PIANO_ROLL_LABEL_WIDTH;
  return {
    x: box.x + PIANO_ROLL_LABEL_WIDTH + (tick / durationTicks) * rollWidth,
    y: box.y + box.height / 2,
  };
}

async function dragRulerRange(
  page: Page,
  startTick: number,
  endTick: number,
  durationTicks: number,
) {
  const ruler = page.locator(".piano-roll-time-ruler");
  await expect(ruler).toBeVisible();
  const box = await ruler.boundingBox();
  if (!box) {
    throw new Error("Time ruler has no bounding box");
  }

  const rollWidth = box.width - PIANO_ROLL_LABEL_WIDTH;
  const startX = PIANO_ROLL_LABEL_WIDTH + (startTick / durationTicks) * rollWidth;
  const endX = PIANO_ROLL_LABEL_WIDTH + (endTick / durationTicks) * rollWidth;
  const y = box.height / 2;

  await ruler.evaluate(
    (element, payload) => {
      const target = element as HTMLCanvasElement;
      const { startX, endX, y } = payload;
      const steps = 8;
      target.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          buttons: 1,
          pointerId: 1,
          clientX: target.getBoundingClientRect().left + startX,
          clientY: target.getBoundingClientRect().top + y,
        }),
      );
      for (let index = 1; index <= steps; index += 1) {
        const progress = index / steps;
        const x = startX + (endX - startX) * progress;
        target.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            button: 0,
            buttons: 1,
            pointerId: 1,
            clientX: target.getBoundingClientRect().left + x,
            clientY: target.getBoundingClientRect().top + y,
          }),
        );
      }
      target.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          button: 0,
          buttons: 0,
          pointerId: 1,
          clientX: target.getBoundingClientRect().left + endX,
          clientY: target.getBoundingClientRect().top + y,
        }),
      );
    },
    { startX, endX, y },
  );
}

test.describe("overlap conflicts and time ruler", () => {
  test("Next overlap selects both notes in the same-voice conflict", async ({ page }) => {
    await installFakeTauri(page, { importedProject: conflictProject });
    await page.goto("/");
    await importFixture(page);

    await expect(page.getByRole("button", { name: "Next overlap (1)" })).toBeVisible();
    await expect(page.getByLabel("Export readiness summary")).toContainText("1 same-voice overlap");

    await page.getByRole("button", { name: "Next overlap (1)" }).click();

    await expect(page.locator(".selection-details")).toContainText("2 notes selected");
    await expect(page.locator(".selection-details")).toContainText("pitches 60-64");
  });

  test("dragging the time ruler selects every note sounding in that tick range", async ({
    page,
  }) => {
    await installFakeTauri(page, { importedProject: rangeProject });
    await page.goto("/");
    await importFixture(page);

    await dragRulerRange(page, 290, 700, rangeProject.durationTicks);

    await expect(page.locator(".selection-details")).toContainText("2 notes selected");
    await expect(page.locator(".selection-details")).toContainText("pitches 62-64");
  });

  test("clicking the time ruler seeks playback to that tick", async ({ page }) => {
    await installFakeTauri(page, { importedProject: rangeProject });
    await page.goto("/");
    await importFixture(page);

    const middle = await rulerPosition(page, 480, rangeProject.durationTicks);
    await page.mouse.click(middle.x, middle.y);

    await expect(page.locator(".playback-time")).toContainText("0:01");
  });
});
