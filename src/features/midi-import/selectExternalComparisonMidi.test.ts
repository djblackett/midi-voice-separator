import { open } from "@tauri-apps/plugin-dialog";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { selectExternalComparisonMidi } from "./selectExternalComparisonMidi";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

const openMock = vi.mocked(open);

describe("selectExternalComparisonMidi", () => {
  beforeEach(() => {
    openMock.mockReset();
  });

  it("returns null when the chooser is cancelled", async () => {
    openMock.mockResolvedValue(null);

    await expect(selectExternalComparisonMidi()).resolves.toBeNull();
  });

  it("returns the selected MIDI path and restricts the chooser to MIDI files", async () => {
    openMock.mockResolvedValue("C:\\music\\reference.mid");

    await expect(selectExternalComparisonMidi()).resolves.toBe("C:\\music\\reference.mid");
    expect(openMock).toHaveBeenCalledWith(
      expect.objectContaining({
        multiple: false,
        filters: [expect.objectContaining({ extensions: ["mid", "midi"] })],
      }),
    );
  });
});
