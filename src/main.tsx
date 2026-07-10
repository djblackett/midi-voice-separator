import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import "./styles/global.css";

async function startApplication() {
  // The WDIO bridge is initialized only for the dedicated native E2E build.
  if (import.meta.env.VITE_WDIO_NATIVE_TEST === "1") {
    await import("@wdio/tauri-plugin");
  }

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void startApplication();
