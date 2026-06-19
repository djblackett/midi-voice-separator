import { describe, expect, it } from "vitest";
import { resolveSelection } from "./selection";

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
