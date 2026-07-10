import assert from "node:assert/strict";

describe("native Tauri shell", () => {
  it("launches the real desktop window and renders the application shell", async () => {
    // Read document.title via a live script execution rather than the classic
    // getTitle() command, since the latter can return a stale value from
    // session creation on some WebView2 runs.
    await browser.waitUntil(
      async () => (await browser.execute(() => document.title)) === "Chiptune Voice Separator",
      {
        timeout: 30_000,
        interval: 500,
        timeoutMsg: "The native window never reported the expected title.",
      },
    );

    const heading = await $("h1");
    await heading.waitForDisplayed();
    assert.equal(await heading.getText(), "Chiptune Voice Separator");

    const importButton = await $("button=Import MIDI");
    await importButton.waitForDisplayed();
    assert.equal(await importButton.isEnabled(), true);
  });
});
