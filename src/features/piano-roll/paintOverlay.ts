import type { PaintTool, Point } from "./paintBrush";

/**
 * Everything the paint-cursor overlay needs for one frame. Assembled by
 * `PianoRoll.tsx` from refs (cursor position, in-progress lasso path) and
 * props (tool, radius, voice color) each animation frame — the overlay
 * canvas is redrawn imperatively, never through React state.
 */
export interface PaintOverlayFrame {
  tool: PaintTool;
  cursor: Point | null;
  brushRadius: number;
  /** Fill color of the active voice, or null when no voice is selected yet. */
  voiceColor: string | null;
  /** In-progress freehand lasso path, empty when not mid-gesture. */
  lassoPath: readonly Point[];
  /** Animates the lasso's marching-ants dashes; any monotonic value works. */
  antsPhase: number;
  /** 0..1 opacity of the brush-size HUD bubble shown while resizing. */
  sizeHudOpacity: number;
}

const NO_VOICE_COLOR = "#94a3b8";
const HALO_COLOR = "rgba(15, 23, 42, 0.85)";

function withAlpha(hexColor: string, alpha: number): string {
  const value = Number.parseInt(hexColor.slice(1), 16);
  if (!Number.isFinite(value) || hexColor.length !== 7) {
    return `rgba(148, 163, 184, ${alpha})`;
  }
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Strokes a path twice — a dark wide halo, then the accent color — so the
 * cursor stays visible over any background (note fills, gridlines, black-
 * key rows), the same trick Photoshop's brush outline uses.
 */
function dualStroke(
  context: CanvasRenderingContext2D,
  accent: string,
  drawPath: () => void,
  dash: number[] = [],
  dashOffset = 0,
): void {
  context.setLineDash(dash);
  context.lineDashOffset = dashOffset;
  context.strokeStyle = HALO_COLOR;
  context.lineWidth = 3.5;
  drawPath();
  context.stroke();
  context.strokeStyle = accent;
  context.lineWidth = 1.5;
  drawPath();
  context.stroke();
  context.setLineDash([]);
  context.lineDashOffset = 0;
}

function drawBrushCursor(
  context: CanvasRenderingContext2D,
  cursor: Point,
  radius: number,
  voiceColor: string | null,
): void {
  const accent = voiceColor ?? NO_VOICE_COLOR;

  if (voiceColor) {
    context.fillStyle = withAlpha(voiceColor, 0.1);
    context.beginPath();
    context.arc(cursor.x, cursor.y, radius, 0, Math.PI * 2);
    context.fill();
  }

  context.save();
  if (voiceColor) {
    context.shadowColor = withAlpha(voiceColor, 0.55);
    context.shadowBlur = 10;
  }
  dualStroke(
    context,
    accent,
    () => {
      context.beginPath();
      context.arc(cursor.x, cursor.y, radius, 0, Math.PI * 2);
    },
    voiceColor ? [] : [5, 4],
  );
  context.restore();

  context.fillStyle = accent;
  context.beginPath();
  context.arc(cursor.x, cursor.y, 1.75, 0, Math.PI * 2);
  context.fill();
}

function drawPencilCursor(
  context: CanvasRenderingContext2D,
  cursor: Point,
  voiceColor: string | null,
): void {
  const accent = voiceColor ?? NO_VOICE_COLOR;
  const gap = 4;
  const arm = 9;

  dualStroke(context, accent, () => {
    context.beginPath();
    context.moveTo(cursor.x - gap - arm, cursor.y);
    context.lineTo(cursor.x - gap, cursor.y);
    context.moveTo(cursor.x + gap, cursor.y);
    context.lineTo(cursor.x + gap + arm, cursor.y);
    context.moveTo(cursor.x, cursor.y - gap - arm);
    context.lineTo(cursor.x, cursor.y - gap);
    context.moveTo(cursor.x, cursor.y + gap);
    context.lineTo(cursor.x, cursor.y + gap + arm);
  });

  context.fillStyle = accent;
  context.beginPath();
  context.arc(cursor.x, cursor.y, 1.75, 0, Math.PI * 2);
  context.fill();
}

function drawLassoCursor(
  context: CanvasRenderingContext2D,
  cursor: Point,
  voiceColor: string | null,
): void {
  const accent = voiceColor ?? NO_VOICE_COLOR;

  dualStroke(context, accent, () => {
    context.beginPath();
    context.arc(cursor.x, cursor.y, 3.5, 0, Math.PI * 2);
    // A short diagonal "rope tail" distinguishes the lasso cursor from a
    // tiny brush at a glance.
    context.moveTo(cursor.x + 3, cursor.y + 3);
    context.lineTo(cursor.x + 10, cursor.y + 10);
  });
}

function drawWandCursor(
  context: CanvasRenderingContext2D,
  cursor: Point,
  voiceColor: string | null,
): void {
  const accent = voiceColor ?? NO_VOICE_COLOR;

  // Diagonal wand stick trailing down-right from the hotspot, with a
  // four-point sparkle at the tip.
  dualStroke(context, accent, () => {
    context.beginPath();
    context.moveTo(cursor.x + 4, cursor.y + 4);
    context.lineTo(cursor.x + 13, cursor.y + 13);
    const arm = 5;
    context.moveTo(cursor.x - arm, cursor.y);
    context.lineTo(cursor.x + arm, cursor.y);
    context.moveTo(cursor.x, cursor.y - arm);
    context.lineTo(cursor.x, cursor.y + arm);
    const diag = 3;
    context.moveTo(cursor.x - diag, cursor.y - diag);
    context.lineTo(cursor.x + diag, cursor.y + diag);
    context.moveTo(cursor.x - diag, cursor.y + diag);
    context.lineTo(cursor.x + diag, cursor.y - diag);
  });

  context.fillStyle = accent;
  context.beginPath();
  context.arc(cursor.x, cursor.y, 1.5, 0, Math.PI * 2);
  context.fill();
}

function drawLassoPath(
  context: CanvasRenderingContext2D,
  path: readonly Point[],
  voiceColor: string | null,
  antsPhase: number,
): void {
  if (path.length < 2) {
    return;
  }
  const accent = voiceColor ?? NO_VOICE_COLOR;

  const tracePath = () => {
    context.beginPath();
    context.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i += 1) {
      context.lineTo(path[i].x, path[i].y);
    }
    context.closePath();
  };

  if (voiceColor && path.length >= 3) {
    context.fillStyle = withAlpha(voiceColor, 0.12);
    tracePath();
    context.fill();
  }

  dualStroke(context, accent, tracePath, [6, 4], -antsPhase);

  // Start-point handle: shows where the loop closes back to.
  context.fillStyle = accent;
  context.strokeStyle = HALO_COLOR;
  context.lineWidth = 1.5;
  context.beginPath();
  context.arc(path[0].x, path[0].y, 3, 0, Math.PI * 2);
  context.fill();
  context.stroke();
}

function drawSizeHud(
  context: CanvasRenderingContext2D,
  cursor: Point,
  radius: number,
  voiceColor: string | null,
  opacity: number,
  canvasWidth: number,
): void {
  const label = `${radius * 2} px`;
  context.save();
  context.globalAlpha = opacity;
  context.font = "12px system-ui";
  const textWidth = context.measureText(label).width;
  const padding = 6;
  const boxWidth = textWidth + padding * 2;
  const boxHeight = 20;
  const x = Math.min(cursor.x + radius + 12, canvasWidth - boxWidth - 4);
  const y = cursor.y - boxHeight / 2;

  context.fillStyle = "rgba(15, 23, 42, 0.92)";
  context.strokeStyle = voiceColor ?? NO_VOICE_COLOR;
  context.lineWidth = 1;
  context.beginPath();
  context.roundRect(x, y, boxWidth, boxHeight, 4);
  context.fill();
  context.stroke();

  context.fillStyle = "#e5e7eb";
  context.fillText(label, x + padding, y + 14);
  context.restore();
}

export function drawPaintOverlay(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  frame: PaintOverlayFrame,
): void {
  context.clearRect(0, 0, width, height);

  drawLassoPath(context, frame.lassoPath, frame.voiceColor, frame.antsPhase);

  if (!frame.cursor) {
    return;
  }

  if (frame.tool === "brush") {
    drawBrushCursor(context, frame.cursor, frame.brushRadius, frame.voiceColor);
    if (frame.sizeHudOpacity > 0) {
      drawSizeHud(
        context,
        frame.cursor,
        frame.brushRadius,
        frame.voiceColor,
        frame.sizeHudOpacity,
        width,
      );
    }
  } else if (frame.tool === "pencil") {
    drawPencilCursor(context, frame.cursor, frame.voiceColor);
  } else if (frame.tool === "wand") {
    drawWandCursor(context, frame.cursor, frame.voiceColor);
  } else {
    drawLassoCursor(context, frame.cursor, frame.voiceColor);
  }
}
