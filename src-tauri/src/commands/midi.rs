use std::{fs, path::Path};

use crate::{
    error::AppError,
    midi::{
        exporter::export_midi_bytes, parser::parse_midi_project, ExportMidiResultDto,
        MidiProjectDto,
    },
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

#[tauri::command]
pub fn export_midi(path: String, project: MidiProjectDto) -> Result<ExportMidiResultDto, AppError> {
    let trimmed_path = path.trim();
    if trimmed_path.is_empty() {
        return Err(AppError::empty_export_path());
    }

    let path = Path::new(trimmed_path);
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase);

    if !matches!(extension.as_deref(), Some("mid" | "midi")) {
        return Err(AppError::unsupported_extension());
    }

    let bytes = export_midi_bytes(&project).map_err(|error| {
        eprintln!("Failed to encode MIDI export '{}': {error}", path.display());
        error
    })?;

    fs::write(path, bytes).map_err(|error| {
        eprintln!("Failed to write MIDI export '{}': {error}", path.display());
        AppError::from_write_io(&error)
    })?;

    Ok(ExportMidiResultDto {
        path: path.display().to_string(),
        track_count: project.voices.len() + 1,
        note_count: project.notes.len(),
    })
}
