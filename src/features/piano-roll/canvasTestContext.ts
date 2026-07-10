import { vi } from "vitest";

/**
 * One `fillRect`/`strokeRect`/`fillText` call, with a snapshot of the style
 * properties (`fillStyle`, `strokeStyle`, `lineWidth`, `globalAlpha`) as they
 * stood at the moment of the call. The piano-roll draw routines communicate
 * per-shape style by mutating these properties immediately before drawing,
 * the same way the real Canvas2D API works, so a call's arguments alone
 * don't reveal what it was styled with — this does.
 */
export interface StyledCall {
  method: "fillRect" | "strokeRect" | "fillText" | "stroke" | "fill";
  args: unknown[];
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  globalAlpha: number;
}

export interface MockCanvasContext extends CanvasRenderingContext2D {
  /** Every styled draw call, in call order. */
  styledCalls: StyledCall[];
}

/**
 * A `CanvasRenderingContext2D` stand-in for unit-testing draw routines: every
 * method is a spy, and `fillRect`/`strokeRect`/`fillText` additionally log to
 * `styledCalls` with the active style at call time. Draw code is verified by
 * which calls happen, with what arguments and style, not by rendering actual
 * pixels.
 */
export function createMockCanvasContext(): MockCanvasContext {
  let fillStyle: unknown = "";
  let strokeStyle: unknown = "";
  let lineWidth = 1;
  let globalAlpha = 1;
  const styledCalls: StyledCall[] = [];

  function record(method: StyledCall["method"], args: unknown[]): void {
    styledCalls.push({ method, args, fillStyle, strokeStyle, lineWidth, globalAlpha });
  }

  const context = {
    clearRect: vi.fn(),
    fillRect: vi.fn((...args: unknown[]) => record("fillRect", args)),
    strokeRect: vi.fn((...args: unknown[]) => record("strokeRect", args)),
    fillText: vi.fn((...args: unknown[]) => record("fillText", args)),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    arc: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    fill: vi.fn((...args: unknown[]) => record("fill", args)),
    stroke: vi.fn((...args: unknown[]) => record("stroke", args)),
    save: vi.fn(),
    restore: vi.fn(),
    setLineDash: vi.fn(),
    roundRect: vi.fn(),
    measureText: vi.fn(() => ({ width: 20 }) as TextMetrics),
    lineDashOffset: 0,
    shadowColor: "",
    shadowBlur: 0,
    font: "",
    textBaseline: "alphabetic",
    styledCalls,
  };

  Object.defineProperties(context, {
    fillStyle: {
      get: () => fillStyle,
      set: (value: unknown) => {
        fillStyle = value;
      },
    },
    strokeStyle: {
      get: () => strokeStyle,
      set: (value: unknown) => {
        strokeStyle = value;
      },
    },
    lineWidth: {
      get: () => lineWidth,
      set: (value: number) => {
        lineWidth = value;
      },
    },
    globalAlpha: {
      get: () => globalAlpha,
      set: (value: number) => {
        globalAlpha = value;
      },
    },
  });

  return context as unknown as MockCanvasContext;
}
