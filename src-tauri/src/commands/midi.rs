use std::{fs, path::Path};

use crate::{
    error::AppError,
    midi::{parser::parse_midi_project, MidiProjectDto},
};

#[tauri::command]
pub fn import_midi(path: String) -> Result<MidiProjectDto, AppError> {
    let trimmed_path = path.trim();
    if trimmed_path.is_empty() {
        return Err(AppError::empty_path());
    }

    let path = Path::new(trimmed_path);
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase);

    if !matches!(extension.as_deref(), Some("mid" | "midi")) {
        return Err(AppError::unsupported_extension());
    }

    let bytes = fs::read(path).map_err(|error| {
        eprintln!("Failed to read MIDI file '{}': {error}", path.display());
        AppError::from_io(&error)
    })?;

    parse_midi_project(path, &bytes).map_err(|error| {
        eprintln!("Failed to parse MIDI file '{}': {error}", path.display());
        error
    })
}
