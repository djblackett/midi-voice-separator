import { describe, expect, it } from "vitest";
import {
  resolveKeyboardCommand,
  type KeyboardContext,
  type KeyboardEventLike,
} from "./keyboardCommands";

function key(overrides: Partial<KeyboardEventLike> & { key: string }): KeyboardEventLike {
  return {
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    repeat: false,
    ...overrides,
  };
}

function context(overrides: Partial<KeyboardContext> = {}): KeyboardContext {
  return {
    focusInEditableField: false,
    hasProject: true,
    activeSideEditable: true,
    busy: false,
    comparisonOpen: false,
    ...overrides,
  };
}

describe("resolveKeyboardCommand", () => {
  it("ignores every shortcut while a text field is focused", () => {
    const focused = context({ focusInEditableField: true });
    expect(resolveKeyboardCommand(key({ key: "z", ctrlKey: true }), focused)).toBeNull();
    expect(resolveKeyboardCommand(key({ key: "1" }), focused)).toBeNull();
    expect(resolveKeyboardCommand(key({ key: "Escape" }), focused)).toBeNull();
  });

  it("maps undo and redo, telling them apart by shift", () => {
    expect(resolveKeyboardCommand(key({ key: "z", ctrlKey: true }), context())).toBe("undo");
    expect(resolveKeyboardCommand(key({ key: "z", metaKey: true }), context())).toBe("undo");
    expect(
      resolveKeyboardCommand(key({ key: "z", ctrlKey: true, shiftKey: true }), context()),
    ).toBe("redo");
    // Bare z is not undo.
    expect(resolveKeyboardCommand(key({ key: "z" }), context())).toBeNull();
  });

  it("maps the paint tools, brush size, heat toggle, and voice numbers", () => {
    expect(resolveKeyboardCommand(key({ key: "p" }), context())).toBe("toolPencil");
    expect(resolveKeyboardCommand(key({ key: "b" }), context())).toBe("toolBrush");
    expect(resolveKeyboardCommand(key({ key: "L" }), context())).toBe("toolLasso");
    expect(resolveKeyboardCommand(key({ key: "[" }), context())).toBe("brushSmaller");
    expect(resolveKeyboardCommand(key({ key: "]" }), context())).toBe("brushLarger");
    expect(resolveKeyboardCommand(key({ key: "h" }), context())).toBe("toggleConfidenceHeat");
    expect(resolveKeyboardCommand(key({ key: "3" }), context())).toBe("assignVoice3");
  });

  it("maps Tab and Shift+Tab to flagged-note stepping", () => {
    expect(resolveKeyboardCommand(key({ key: "Tab" }), context())).toBe("stepFlaggedForward");
    expect(resolveKeyboardCommand(key({ key: "Tab", shiftKey: true }), context())).toBe(
      "stepFlaggedBackward",
    );
  });

  it("does not fire a tool via a modified chord (Ctrl/Alt+letter)", () => {
    expect(resolveKeyboardCommand(key({ key: "b", ctrlKey: true }), context())).toBeNull();
    expect(resolveKeyboardCommand(key({ key: "b", altKey: true }), context())).toBeNull();
    expect(resolveKeyboardCommand(key({ key: "h", altKey: true }), context())).toBeNull();
  });

  it("blocks editing shortcuts on a read-only side but keeps undo/redo and Escape", () => {
    const readOnly = context({ activeSideEditable: false });
    expect(resolveKeyboardCommand(key({ key: "1" }), readOnly)).toBeNull();
    expect(resolveKeyboardCommand(key({ key: "b" }), readOnly)).toBeNull();
    expect(resolveKeyboardCommand(key({ key: "Tab" }), readOnly)).toBeNull();
    expect(resolveKeyboardCommand(key({ key: "h" }), readOnly)).toBeNull();
    // Navigation and history are still allowed.
    expect(resolveKeyboardCommand(key({ key: "z", ctrlKey: true }), readOnly)).toBe("undo");
    expect(resolveKeyboardCommand(key({ key: "Escape" }), readOnly)).toBe(
      "clearSelectionOrExitPaint",
    );
  });

  it("maps Alt+A / Alt+B to side switching only while a comparison is open", () => {
    const comparing = context({ comparisonOpen: true });
    expect(resolveKeyboardCommand(key({ key: "a", altKey: true }), comparing)).toBe(
      "activateSideA",
    );
    expect(resolveKeyboardCommand(key({ key: "b", altKey: true }), comparing)).toBe(
      "activateSideB",
    );
    // Outside a comparison the chords do nothing.
    expect(resolveKeyboardCommand(key({ key: "b", altKey: true }), context())).toBeNull();
  });

  it("switches side even on a read-only side (navigation, not editing)", () => {
    const readOnlyComparison = context({ comparisonOpen: true, activeSideEditable: false });
    expect(resolveKeyboardCommand(key({ key: "b", altKey: true }), readOnlyComparison)).toBe(
      "activateSideB",
    );
  });

  it("keeps Alt+B (side switch) distinct from bare B (Brush)", () => {
    const comparing = context({ comparisonOpen: true });
    expect(resolveKeyboardCommand(key({ key: "b" }), comparing)).toBe("toolBrush");
    expect(resolveKeyboardCommand(key({ key: "b", altKey: true }), comparing)).toBe(
      "activateSideB",
    );
  });

  it("blocks project-dependent shortcuts when no project is loaded", () => {
    const empty = context({ hasProject: false });
    expect(resolveKeyboardCommand(key({ key: "1" }), empty)).toBeNull();
    expect(resolveKeyboardCommand(key({ key: "b" }), empty)).toBeNull();
    // Escape and undo do not require a project.
    expect(resolveKeyboardCommand(key({ key: "Escape" }), empty)).toBe("clearSelectionOrExitPaint");
    expect(resolveKeyboardCommand(key({ key: "z", ctrlKey: true }), empty)).toBe("undo");
  });
});
