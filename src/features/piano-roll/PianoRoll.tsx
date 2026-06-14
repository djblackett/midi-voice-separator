import { useEffect, useRef, useState } from "react";
import type { MidiProject } from "../../domain/midi/midiProject";
import { buildViewport, drawPianoRoll } from "./drawPianoRoll";

interface PianoRollProps {
  project: MidiProject | null;
}

export function PianoRoll({ project }: PianoRollProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) {
        return;
      }
      setSize({
        width: Math.floor(entry.contentRect.width),
        height: Math.floor(entry.contentRect.height),
      });
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width <= 0 || size.height <= 0) {
      return;
    }

    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(size.width * ratio);
    canvas.height = Math.floor(size.height * ratio);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawPianoRoll(context, project, buildViewport(project, size.width, size.height));
  }, [project, size]);

  return (
    <div className="piano-roll-shell" ref={containerRef}>
      <canvas ref={canvasRef} aria-label="Piano roll note visualization" />
    </div>
  );
}
