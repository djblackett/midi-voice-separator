import { describe, expect, it } from "vitest";
import { formatPlaybackTime } from "./formatPlaybackTime";

describe("formatPlaybackTime", () => {
  it("formats sub-minute durations", () => {
    expect(formatPlaybackTime(5)).toBe("0:05");
  });

  it("formats whole minutes", () => {
    expect(formatPlaybackTime(60)).toBe("1:00");
  });

  it("formats minutes and seconds", () => {
    expect(formatPlaybackTime(125)).toBe("2:05");
  });

  it("rounds to the nearest second", () => {
    expect(formatPlaybackTime(59.6)).toBe("1:00");
  });

  it("clamps negative durations to zero", () => {
    expect(formatPlaybackTime(-5)).toBe("0:00");
  });
});
