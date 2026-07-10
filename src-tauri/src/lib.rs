mod commands;
mod error;
mod midi;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());

    #[cfg(debug_assertions)]
    let builder = builder.plugin(tauri_plugin_wdio::init());

    builder
        .invoke_handler(tauri::generate_handler![
            commands::backend_status,
            commands::midi::import_midi,
            commands::midi::export_midi,
            commands::midi::reassign_voices,
            commands::midi::evaluate_assignment
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
