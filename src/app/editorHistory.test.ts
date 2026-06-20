import { describe, expect, it } from "vitest";
import {
  createEditorHistory,
  pushHistory,
  redoHistory,
  undoHistory,
  type EditorSnapshot,
} from "./editorHistory";

function snapshot(label: string): EditorSnapshot {
  return {
    project: null,
    voiceOverrides: { [label]: "voice-1" },
    voiceOrder: [label],
    voiceLabels: {},
    rangeAssignedNoteIds: new Set(),
  };
}

describe("pushHistory", () => {
  it("appends a snapshot and clears the redo stack", () => {
    const history = pushHistory(
      { past: [snapshot("a")], future: [snapshot("redo")] },
      snapshot("b"),
    );

    expect(history.past).toEqual([snapshot("a"), snapshot("b")]);
    expect(history.future).toEqual([]);
  });

  it("caps the undo stack at 50 entries, dropping the oldest", () => {
    let history = createEditorHistory();
    for (let index = 0; index < 55; index += 1) {
      history = pushHistory(history, snapshot(`s${index}`));
    }

    expect(history.past).toHaveLength(50);
    expect(history.past[0]).toEqual(snapshot("s5"));
    expect(history.past[49]).toEqual(snapshot("s54"));
  });
});

describe("undoHistory", () => {
  it("returns null when there is nothing to undo", () => {
    expect(undoHistory(createEditorHistory(), snapshot("current"))).toBeNull();
  });

  it("moves the most recent past snapshot into the present and current into future", () => {
    const history = pushHistory(createEditorHistory(), snapshot("before"));

    const result = undoHistory(history, snapshot("current"));

    expect(result?.snapshot).toEqual(snapshot("before"));
    expect(result?.history.past).toEqual([]);
    expect(result?.history.future).toEqual([snapshot("current")]);
  });
});

describe("redoHistory", () => {
  it("returns null when there is nothing to redo", () => {
    expect(redoHistory(createEditorHistory(), snapshot("current"))).toBeNull();
  });

  it("moves the next future snapshot back into the present and current into past", () => {
    const afterUndo = undoHistory(
      pushHistory(createEditorHistory(), snapshot("before")),
      snapshot("current"),
    );
    const history = afterUndo!.history;

    const result = redoHistory(history, afterUndo!.snapshot);

    expect(result?.snapshot).toEqual(snapshot("current"));
    expect(result?.history.past).toEqual([snapshot("before")]);
    expect(result?.history.future).toEqual([]);
  });
});
