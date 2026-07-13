import { describe, expect, it } from "vitest";
import type { MidiNote, MidiVoice } from "../../domain/midi/midiProject";
import type { PianoRollViewport } from "../../domain/midi/viewport";
import {
  buildVoiceLaneLayout,
  findVoiceLane,
  findVoiceLaneAtY,
  voiceLaneNoteRect,
  VOICE_LANE_LABEL_WIDTH,
} from "./voiceLanes";

function voice(overrides: Partial<MidiVoice> = {}): MidiVoice {
  return {
    id: "voice-1",
    label: "Lead",
    noteCount: 4,
    lowestPitch: 48,
    highestPitch: 72,
    ...overrides,
  };
}

function note(overrides: Partial<MidiNote> = {}): MidiNote {
  return {
    id: "n1",
    voiceId: "voice-1",
    sourceTrackIndex: 0,
    channel: 0,
    pitch: 60,
    velocity: 100,
    startTick: 120,
    endTick: 360,
    durationTicks: 240,
    assignmentConfidence: 1,
    assignmentReason: "IMPORTED",
    ...overrides,
  };
}

const viewport: PianoRollViewport = {
  width: 1096,
  height: 300,
  startTick: 0,
  endTick: 1000,
  lowestPitch: 0,
  highestPitch: 127,
};

describe("buildVoiceLaneLayout", () => {
  it("creates stable equal-height lanes in voice order", () => {
    const lanes = buildVoiceLaneLayout(
      [voice({ id: "voice-1", label: "Lead" }), voice({ id: "percussion", label: "Percussion" })],
      300,
    );

    expect(lanes).toMatchObject([
      { rowIndex: 0, voiceId: "voice-1", label: "Lead", y: 0, height: 150 },
      { rowIndex: 1, voiceId: "percussion", label: "Percussion", y: 150, height: 150 },
    ]);
  });

  it("keeps lanes usable when many voices exceed the available height", () => {
    const lanes = buildVoiceLaneLayout(
      Array.from({ length: 20 }, (_, index) => voice({ id: `voice-${index + 1}` })),
      300,
    );

    expect(lanes[0].height).toBe(36);
    expect(lanes[19].y).toBe(684);
  });

  it("uses a resolved lane height and scroll offset while retaining row indexes", () => {
    const lanes = buildVoiceLaneLayout(
      [voice({ id: "voice-1" }), voice({ id: "voice-2" }), voice({ id: "voice-3" })],
      72,
      { laneHeight: 36, scrollTopPx: 18 },
    );

    expect(lanes).toMatchObject([
      { rowIndex: 0, voiceId: "voice-1", y: -18, height: 36 },
      { rowIndex: 1, voiceId: "voice-2", y: 18, height: 36 },
      { rowIndex: 2, voiceId: "voice-3", y: 54, height: 36 },
    ]);
  });
});

describe("voice lane lookup", () => {
  const lanes = buildVoiceLaneLayout([voice({ id: "voice-1" }), voice({ id: "voice-2" })], 200);

  it("finds lanes by voice id", () => {
    expect(findVoiceLane(lanes, "voice-2")?.y).toBe(100);
    expect(findVoiceLane(lanes, "missing")).toBeNull();
  });

  it("finds lanes by y position", () => {
    expect(findVoiceLaneAtY(lanes, 10)?.voiceId).toBe("voice-1");
    expect(findVoiceLaneAtY(lanes, 150)?.voiceId).toBe("voice-2");
    expect(findVoiceLaneAtY(lanes, 250)).toBeNull();
  });
});

describe("voiceLaneNoteRect", () => {
  it("uses the shared horizontal viewport with the lane label gutter", () => {
    const lane = buildVoiceLaneLayout([voice()], 100)[0];
    const rect = voiceLaneNoteRect(note(), lane, viewport);

    expect(rect.x).toBe(VOICE_LANE_LABEL_WIDTH + 120);
    expect(rect.width).toBe(240);
  });

  it("maps pitch vertically inside its own voice lane", () => {
    const lane = buildVoiceLaneLayout([voice({ lowestPitch: 48, highestPitch: 72 })], 100)[0];
    const high = voiceLaneNoteRect(note({ pitch: 72 }), lane, viewport);
    const low = voiceLaneNoteRect(note({ pitch: 48 }), lane, viewport);

    expect(high.y).toBeLessThan(low.y);
    expect(high.y).toBeGreaterThanOrEqual(lane.y);
    expect(low.y + low.height).toBeLessThanOrEqual(lane.y + lane.height);
  });
});
