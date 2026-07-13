import { describe, expect, it } from "vitest";
import { hasCrossedMarqueeThreshold, resolveSelection } from "./selection";

describe("hasCrossedMarqueeThreshold", () => {
  it("latches a crossed threshold when the pointer returns near its start", () => {
    const start = { x: 10, y: 20 };
    const crossed = hasCrossedMarqueeThreshold(start, { x: 15, y: 20 }, 4);

    expect(crossed).toBe(true);
    expect(hasCrossedMarqueeThreshold(start, { x: 11, y: 21 }, 4, crossed)).toBe(true);
  });

  it("stays below threshold until either axis reaches it", () => {
    const start = { x: 10, y: 20 };

    expect(hasCrossedMarqueeThreshold(start, { x: 13, y: 17 }, 4)).toBe(false);
    expect(hasCrossedMarqueeThreshold(start, { x: 10, y: 16 }, 4)).toBe(true);
  });
});

describe("resolveSelection", () => {
  it("replaces the selection on a plain click", () => {
    const next = resolveSelection(new Set(["a"]), {
      type: "click",
      noteId: "b",
      additive: false,
    });

    expect(next).toEqual(new Set(["b"]));
  });

  it("clears the selection when clicking empty space", () => {
    const next = resolveSelection(new Set(["a"]), {
      type: "click",
      noteId: null,
      additive: false,
    });

    expect(next).toEqual(new Set());
  });

  it("toggles a note on shift-click", () => {
    const added = resolveSelection(new Set(["a"]), {
      type: "click",
      noteId: "b",
      additive: true,
    });
    expect(added).toEqual(new Set(["a", "b"]));

    const removed = resolveSelection(new Set(["a", "b"]), {
      type: "click",
      noteId: "b",
      additive: true,
    });
    expect(removed).toEqual(new Set(["a"]));
  });

  it("keeps the current selection when shift-clicking empty space", () => {
    const next = resolveSelection(new Set(["a"]), {
      type: "click",
      noteId: null,
      additive: true,
    });

    expect(next).toEqual(new Set(["a"]));
  });

  it("replaces the selection with a marquee result", () => {
    const next = resolveSelection(new Set(["a"]), {
      type: "marquee",
      noteIds: ["b", "c"],
      additive: false,
    });

    expect(next).toEqual(new Set(["b", "c"]));
  });

  it("unions the selection with a shift-marquee result", () => {
    const next = resolveSelection(new Set(["a"]), {
      type: "marquee",
      noteIds: ["a", "b"],
      additive: true,
    });

    expect(next).toEqual(new Set(["a", "b"]));
  });
});
