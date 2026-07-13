import { expect, test, type Page } from "@playwright/test";
import { buildFixtureProject, installFakeTauri, note, voice } from "./fixtures/tauriMock";

const VOICE_LANE_LABEL_WIDTH = 96;
const LANE_PADDING_Y = 6;
const MIN_NOTE_HEIGHT = 5;
const MAX_NOTE_HEIGHT = 12;

interface LaneFixtureNote {
  pitch: number;
  startTick: number;
  endTick: number;
  voiceIndex: number;
  lowestPitch: number;
  highestPitch: number;
}

const leadNote: LaneFixtureNote = {
  pitch: 72,
  startTick: 480,
  endTick: 720,
  voiceIndex: 1,
  lowestPitch: 72,
  highestPitch: 76,
};

const percussionNote: LaneFixtureNote = {
  pitch: 36,
  startTick: 120,
  endTick: 360,
  voiceIndex: 2,
  lowestPitch: 36,
  highestPitch: 36,
};

const laneProject = buildFixtureProject(
  [
    note("bass", "voice-1", 48, 0, { endTick: 240, durationTicks: 240 }),
    note("lead", "voice-2", leadNote.pitch, leadNote.startTick, {
      endTick: leadNote.endTick,
      durationTicks: leadNote.endTick - leadNote.startTick,
    }),
    note("lead-high", "voice-2", 76, 760, { endTick: 900, durationTicks: 140 }),
    note("kick", "percussion", percussionNote.pitch, percussionNote.startTick, {
      endTick: percussionNote.endTick,
      durationTicks: percussionNote.endTick - percussionNote.startTick,
      assignmentReason: "PERCUSSION",
    }),
  ],
  [
    voice("voice-1", "Bass", 1, 48, 48),
    voice("voice-2", "Lead", 2, 72, 76),
    voice("percussion", "Percussion", 1, 36, 36),
  ],
  { durationTicks: 960 },
);

async function importFixture(page: Page) {
  await page.getByRole("button", { name: "Import MIDI" }).click();
  await page.waitForSelector(".piano-roll-toolbar");
}

function laneNoteCenter(
  target: LaneFixtureNote,
  canvasBox: { width: number; height: number },
  durationTicks: number,
  voiceCount: number,
) {
  const laneHeight = Math.max(36, canvasBox.height / voiceCount);
  const laneY = target.voiceIndex * laneHeight;
  const innerHeight = Math.max(1, laneHeight - LANE_PADDING_Y * 2);
  const pitchSpan = Math.max(1, target.highestPitch - target.lowestPitch + 1);
  const noteHeight = Math.min(MAX_NOTE_HEIGHT, Math.max(MIN_NOTE_HEIGHT, innerHeight / pitchSpan));
  const pitchOffset =
    ((target.highestPitch - target.pitch) / pitchSpan) * Math.max(1, innerHeight - noteHeight);
  const rollWidth = canvasBox.width - VOICE_LANE_LABEL_WIDTH;
  const x = VOICE_LANE_LABEL_WIDTH + (target.startTick / durationTicks) * rollWidth;
  const endX = VOICE_LANE_LABEL_WIDTH + (target.endTick / durationTicks) * rollWidth;
  const y = laneY + LANE_PADDING_Y + pitchOffset;

  return { x: (x + endX) / 2, y: y + noteHeight / 2 };
}

async function clickNoteInLaneView(page: Page, target: LaneFixtureNote) {
  // .first(): the interactive roll canvas — the shell's second canvas is
  // the pointer-transparent paint-cursor overlay.
  const canvas = page.getByLabel("Piano roll note visualization");
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error("Piano roll canvas has no bounding box");
  }
  const local = laneNoteCenter(target, box, laneProject.durationTicks, laneProject.voices.length);
  await page.mouse.move(box.x + local.x, box.y + local.y);
  await page.mouse.down();
  await page.mouse.up();
}

async function switchToVoiceLanes(page: Page) {
  const lanesButton = page.getByRole("button", { name: "Voice lanes" });
  await lanesButton.click();
  await expect(lanesButton).toHaveAttribute("aria-pressed", "true");
}

async function dragLaneRulerRange(page: Page, startTick: number, endTick: number) {
  const ruler = page.locator(".piano-roll-time-ruler");
  const box = await ruler.boundingBox();
  if (!box) {
    throw new Error("Time ruler has no bounding box");
  }
  const rollWidth = box.width - VOICE_LANE_LABEL_WIDTH;
  const startX = VOICE_LANE_LABEL_WIDTH + (startTick / laneProject.durationTicks) * rollWidth;
  const endX = VOICE_LANE_LABEL_WIDTH + (endTick / laneProject.durationTicks) * rollWidth;

  await ruler.evaluate(
    (element, payload) => {
      const target = element as HTMLCanvasElement;
      const bounds = target.getBoundingClientRect();
      const y = bounds.height / 2;
      const pointer = (type: string, x: number, buttons: number) =>
        target.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            button: 0,
            buttons,
            pointerId: 1,
            clientX: bounds.left + x,
            clientY: bounds.top + y,
          }),
        );

      pointer("pointerdown", payload.startX, 1);
      pointer("pointermove", payload.endX, 1);
      pointer("pointerup", payload.endX, 0);
    },
    { startX, endX },
  );
}

test.describe("voice lane view", () => {
  test("the view toggle switches to read-only voice lanes and back", async ({ page }) => {
    await installFakeTauri(page, { importedProject: laneProject });
    await page.goto("/");
    await importFixture(page);

    const pianoButton = page.getByRole("button", { name: "Piano roll" });
    const lanesButton = page.getByRole("button", { name: "Voice lanes" });
    await expect(pianoButton).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: "Paint mode: off" }).click();
    await expect(page.getByRole("button", { name: "Paint mode: on" })).toBeVisible();

    await lanesButton.click();
    await expect(lanesButton).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Paint mode: off" })).toBeVisible();

    await pianoButton.click();
    await expect(pianoButton).toHaveAttribute("aria-pressed", "true");
  });

  test("clicking a note in voice lanes selects it", async ({ page }) => {
    await installFakeTauri(page, { importedProject: laneProject });
    await page.goto("/");
    await importFixture(page);

    await switchToVoiceLanes(page);
    await clickNoteInLaneView(page, leadNote);

    const details = page.locator(".selection-details dl");
    await expect(details).toContainText("72");
    await expect(details).toContainText("voice-2");
  });

  test("the percussion lane is rendered and selectable", async ({ page }) => {
    await installFakeTauri(page, { importedProject: laneProject });
    await page.goto("/");
    await importFixture(page);

    await switchToVoiceLanes(page);
    await expect(page.locator(".piano-roll-legend")).toContainText("Percussion");
    await clickNoteInLaneView(page, percussionNote);

    const details = page.locator(".selection-details dl");
    await expect(details).toContainText("36");
    await expect(details).toContainText("percussion");
  });

  test("ruler, zoom anchor, and minimap use the 96px lane gutter", async ({ page }) => {
    await installFakeTauri(page, { importedProject: laneProject });
    await page.goto("/");
    await importFixture(page);
    await switchToVoiceLanes(page);

    await expect(page.locator(".piano-roll-minimap")).toHaveCSS(
      "left",
      `${VOICE_LANE_LABEL_WIDTH}px`,
    );

    const canvas = page.getByLabel("Piano roll note visualization");
    await canvas.evaluate((element, gutterWidth) => {
      const target = element as HTMLCanvasElement;
      const bounds = target.getBoundingClientRect();
      target.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          deltaY: -100,
          clientX: bounds.left + gutterWidth,
          clientY: bounds.top + bounds.height / 2,
        }),
      );
    }, VOICE_LANE_LABEL_WIDTH);

    await expect(page.getByRole("button", { name: /Reset zoom/ })).toBeVisible();
    await expect
      .poll(async () => {
        return page
          .locator(".piano-roll-minimap-window")
          .evaluate((element) => Number.parseFloat((element as HTMLElement).style.left));
      })
      .toBeCloseTo(0, 5);

    await page.getByRole("button", { name: /Reset zoom/ }).click();
    await clickNoteInLaneView(page, leadNote);
    await expect(page.locator(".selection-details dl")).toContainText("voice-2");

    await dragLaneRulerRange(page, 450, 470);
    await expect(page.locator(".selection-details")).toContainText("No note selected");
  });
});
