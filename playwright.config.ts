import { defineConfig, devices } from "@playwright/test";

// End-to-end specs drive the real Vite dev-server bundle in Chromium with a
// faked Tauri IPC boundary (see e2e/fixtures/tauriMock.ts) -- no
// tauri-driver/WebDriver is configured for this project, so these tests
// verify frontend logic and wiring, not native file-dialog or Rust IPC
// behavior. `reuseExistingServer` is on locally since `pnpm tauri dev` is
// usually already running on port 1420; CI always starts a fresh server.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  // Web Audio transport tests share finite browser audio resources. One worker keeps the suite deterministic; the tests remain isolated by Playwright contexts.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:1420",
    trace: "on-first-retry",
    // Playback specs create a real Web Audio AudioContext; Chromium's
    // autoplay policy can otherwise leave it suspended even after a real
    // click-driven gesture in some headless configurations.
    launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:1420",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
