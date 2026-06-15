mod commands;
mod error;
mod midi;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::backend_status,
            commands::midi::import_midi,
            commands::midi::export_midi
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
