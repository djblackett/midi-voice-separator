import { describe, expect, it } from "vitest";
import { createMockCanvasContext } from "./canvasTestContext";
import type { PaintTool, Point } from "./paintBrush";
import { drawPaintOverlay, type PaintOverlayFrame } from "./paintOverlay";

function frame(overrides: Partial<PaintOverlayFrame> = {}): PaintOverlayFrame {
  return {
    tool: "brush",
    cursor: { x: 50, y: 50 },
    brushRadius: 10,
    voiceColor: "#38bdf8",
    lassoPath: [],
    antsPhase: 0,
    sizeHudOpacity: 0,
    ...overrides,
  };
}

const cursor: Point = { x: 50, y: 50 };

describe("drawPaintOverlay", () => {
  it("always clears the canvas first", () => {
    const context = createMockCanvasContext();

    drawPaintOverlay(context, 800, 600, frame({ cursor: null }));

    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 800, 600);
  });

  it("draws nothing beyond the clear when there is no cursor and no lasso path", () => {
    const context = createMockCanvasContext();

    drawPaintOverlay(context, 800, 600, frame({ cursor: null, lassoPath: [] }));

    expect(context.arc).not.toHaveBeenCalled();
    expect(context.stroke).not.toHaveBeenCalled();
  });

  it("draws a cursor for every paint tool", () => {
    for (const tool of ["brush", "pencil", "wand", "lasso"] satisfies PaintTool[]) {
      const context = createMockCanvasContext();

      drawPaintOverlay(context, 800, 600, frame({ tool, cursor }));

      expect(context.stroke).toHaveBeenCalled();
    }
  });

  it("shows the brush size HUD only once opacity is above zero", () => {
    const hidden = createMockCanvasContext();
    drawPaintOverlay(hidden, 800, 600, frame({ tool: "brush", sizeHudOpacity: 0 }));
    expect(hidden.fillText).not.toHaveBeenCalled();

    const shown = createMockCanvasContext();
    drawPaintOverlay(
      shown,
      800,
      600,
      frame({ tool: "brush", brushRadius: 10, sizeHudOpacity: 0.8 }),
    );
    expect(shown.fillText).toHaveBeenCalledWith("20 px", expect.any(Number), expect.any(Number));
  });

  it("never shows the size HUD for non-brush tools, even with opacity set", () => {
    const context = createMockCanvasContext();

    drawPaintOverlay(context, 800, 600, frame({ tool: "pencil", sizeHudOpacity: 1 }));

    expect(context.fillText).not.toHaveBeenCalled();
  });

  it("skips the lasso path entirely below two points", () => {
    const context = createMockCanvasContext();

    drawPaintOverlay(context, 800, 600, frame({ cursor: null, lassoPath: [{ x: 0, y: 0 }] }));

    expect(context.moveTo).not.toHaveBeenCalled();
    expect(context.stroke).not.toHaveBeenCalled();
  });

  it("fills the lasso interior once it encloses an area (3+ points)", () => {
    const context = createMockCanvasContext();
    const lassoPath: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];

    drawPaintOverlay(context, 800, 600, frame({ cursor: null, lassoPath }));

    expect(context.fill).toHaveBeenCalled();
    expect(context.stroke).toHaveBeenCalled();
  });

  it("only fills the start-point handle, not the interior, for a two-point lasso path", () => {
    // Below 3 points there's no enclosed area to shade, but the start-point
    // handle dot (showing where the loop would close) always fills.
    const twoPoint = createMockCanvasContext();
    drawPaintOverlay(
      twoPoint,
      800,
      600,
      frame({
        cursor: null,
        lassoPath: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        voiceColor: "#38bdf8",
      }),
    );
    expect(twoPoint.fill).toHaveBeenCalledTimes(1);

    const threePoint = createMockCanvasContext();
    drawPaintOverlay(
      threePoint,
      800,
      600,
      frame({
        cursor: null,
        lassoPath: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
        voiceColor: "#38bdf8",
      }),
    );
    expect(threePoint.fill).toHaveBeenCalledTimes(2);
  });

  it("falls back to the no-voice color's alpha handling when voiceColor is null", () => {
    const context = createMockCanvasContext();

    expect(() =>
      drawPaintOverlay(context, 800, 600, frame({ tool: "brush", voiceColor: null })),
    ).not.toThrow();
    expect(context.stroke).toHaveBeenCalled();
  });
});
