import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { MidiProject } from "../../domain/midi/midiProject";
import { buildViewport, drawPianoRoll } from "./drawPianoRoll";
import { hitTestPianoRollNote } from "./hitTest";

interface PianoRollProps {
  project: MidiProject | null;
  selectedNoteId: string | null;
  onSelectedNoteChange: (noteId: string | null) => void;
}

export function PianoRoll({ project, selectedNoteId, onSelectedNoteChange }: PianoRollProps) {
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
    drawPianoRoll(
      context,
      project,
      buildViewport(project, size.width, size.height),
      selectedNoteId,
    );
  }, [project, selectedNoteId, size]);

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas || size.width <= 0 || size.height <= 0) {
      return;
    }

    const bounds = canvas.getBoundingClientRect();
    const point = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
    const note = hitTestPianoRollNote(
      point,
      project,
      buildViewport(project, size.width, size.height),
    );
    onSelectedNoteChange(note?.id ?? null);
  }

  return (
    <div className="piano-roll-shell" ref={containerRef}>
      <canvas
        ref={canvasRef}
        aria-label="Piano roll note visualization"
        onPointerDown={handlePointerDown}
      />
    </div>
  );
}
