pub mod midi;

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendStatus {
    status: &'static str,
    application: &'static str,
}

#[tauri::command]
pub fn backend_status() -> BackendStatus {
    BackendStatus {
        status: "ready",
        application: "Chiptune Voice Separator",
    }
}
