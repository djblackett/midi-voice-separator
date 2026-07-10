import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const appBinaryPath = path.join(
  root,
  "src-tauri",
  "target",
  "debug",
  "chiptune-voice-separator.exe",
);
export const config = {
  runner: "local",
  specs: ["./native-e2e/**/*.e2e.mjs"],
  maxInstances: 1,
  logLevel: "warn",
  waitforTimeout: 10_000,
  connectionRetryTimeout: 30_000,
  connectionRetryCount: 1,
  framework: "mocha",
  mochaOpts: { ui: "bdd", timeout: 60_000 },
  reporters: ["spec"],
  services: [
    [
      "@wdio/tauri-service",
      {
        appBinaryPath,
        driverProvider: "external",
        autoDownloadEdgeDriver: true,
        logLevel: "warn",
      },
    ],
  ],
  capabilities: [{ browserName: "tauri", "tauri:options": { application: appBinaryPath } }],
  async onPrepare() {
    // A prior run that was killed mid-session can leave the app binary and its
    // msedgewebview2 children running, holding a lock on the shared WebView2
    // profile in %LOCALAPPDATA%. That makes the next run's webview silently
    // hang on about:blank forever, so clear out any stragglers first.
    spawnSync("taskkill", ["/IM", "chiptune-voice-separator.exe", "/T", "/F"], { stdio: "ignore" });
    spawnSync("taskkill", ["/IM", "tauri-driver.exe", "/T", "/F"], { stdio: "ignore" });
    spawnSync("taskkill", ["/IM", "msedgedriver.exe", "/T", "/F"], { stdio: "ignore" });

    // `cargo build` alone always compiles with Tauri's dev-mode routing (loading
    // devUrl), regardless of debug/release profile — only the `tauri` CLI enables
    // the `custom-protocol` feature that embeds frontendDist into the binary.
    const build = spawnSync("pnpm.cmd", ["tauri", "build", "--debug", "--no-bundle"], {
      cwd: root,
      env: { ...process.env, VITE_WDIO_NATIVE_TEST: "1" },
      stdio: "inherit",
      shell: true,
    });
    if (build.status !== 0) throw new Error("Unable to build the native E2E application binary.");
  },
  onComplete() {
    // The service owns the driver lifecycle. These are defensive cleanups for
    // interrupted Windows sessions, which can otherwise lock WebView2's shared
    // profile and poison the next run.
    spawnSync("taskkill", ["/IM", "chiptune-voice-separator.exe", "/T", "/F"], { stdio: "ignore" });
    spawnSync("taskkill", ["/IM", "msedgedriver.exe", "/T", "/F"], { stdio: "ignore" });
  },
};
