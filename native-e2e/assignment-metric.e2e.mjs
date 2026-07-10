import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixturePath = path.join(root, "fixtures", "two-note-smoke.mid");
const profile = { id: "GENERAL_PURPOSE", version: 1 };

describe("native assignment model cost IPC", () => {
  it("returns the versioned component report repeatably through real Tauri IPC", async () => {
    await browser.waitUntil(
      async () => (await browser.execute(() => document.title)) === "Chiptune Voice Separator",
      { timeout: 30_000, interval: 500, timeoutMsg: "The native window never finished loading." },
    );

    const project = await browser.execute(
      async (importPath) => window.__TAURI__.core.invoke("import_midi", { path: importPath }),
      fixturePath,
    );
    const request = { ppq: project.ppq, notes: project.notes, profile };
    const first = await browser.execute(
      async (evaluationRequest) =>
        window.__TAURI__.core.invoke("evaluate_assignment", { request: evaluationRequest }),
      request,
    );
    const second = await browser.execute(
      async (evaluationRequest) =>
        window.__TAURI__.core.invoke("evaluate_assignment", { request: evaluationRequest }),
      request,
    );

    assert.deepEqual(second, first, "the same request should serialize an identical report");
    assert.deepEqual(first.metric, { id: "ASSIGNMENT_MODEL_COST", version: 1 });
    assert.deepEqual(first.profile, profile);
    assert.equal(first.melodicNoteCount, 2);
    assert.equal(first.excludedPercussionNoteCount, 0);
    assert.equal(first.melodicVoiceCount, 1);
    assert.ok(first.totalCost > 0);
    assert.deepEqual(
      first.components.map((component) => component.id),
      [
        "VOICE_COMPLEXITY",
        "PITCH_MOTION",
        "REGISTER_EXPANSION",
        "SILENCE_GAP",
        "CHANNEL_SWITCH",
        "VOICE_CROSSING",
      ],
    );
    assert.deepEqual(first.hardViolations, []);
  });

  it("returns a structured invalid-evaluation error through real Tauri IPC", async () => {
    const error = await browser.execute(async (evaluationProfile) => {
      try {
        await window.__TAURI__.core.invoke("evaluate_assignment", {
          request: { ppq: 0, notes: [], profile: evaluationProfile },
        });
        return null;
      } catch (caught) {
        return caught;
      }
    }, profile);

    assert.deepEqual(error, {
      code: "INVALID_ASSIGNMENT_EVALUATION",
      message: "Assignment cost requires a positive PPQ value.",
    });
  });
});
