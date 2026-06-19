use std::{collections::HashMap, fs, path::Path};

use crate::{
    error::AppError,
    midi::{
        exporter::export_midi_bytes,
        parser::parse_midi_project,
        voice_assignment::{assign_heuristic_voices_with_locks, summarize_separation_quality},
        ExportMidiResultDto, MidiProjectDto,
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

#[tauri::command]
pub fn reassign_voices(
    mut project: MidiProjectDto,
    locked: HashMap<String, String>,
) -> Result<MidiProjectDto, AppError> {
    project.voices = assign_heuristic_voices_with_locks(&mut project.notes, &locked);
    project.separation_summary = summarize_separation_quality(&project.notes);
    Ok(project)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppErrorCode;
    use crate::midi::model::{
        AssignmentReason, MidiNoteDto, MidiVoiceDto, SeparationSummaryDto, TempoChangeDto,
        TimeSignatureDto,
    };
    use std::path::PathBuf;

    fn note(id: &str, voice_id: &str, pitch: u8, start_tick: u64, end_tick: u64) -> MidiNoteDto {
        MidiNoteDto {
            id: id.to_string(),
            voice_id: voice_id.to_string(),
            source_track_index: 0,
            channel: 0,
            pitch,
            velocity: 100,
            start_tick,
            end_tick,
            duration_ticks: end_tick - start_tick,
            assignment_confidence: 1.0,
            assignment_reason: AssignmentReason::Imported,
        }
    }

    fn project() -> MidiProjectDto {
        MidiProjectDto {
            file_name: "song.mid".to_string(),
            format: "parallel".to_string(),
            ppq: 480,
            duration_ticks: 960,
            track_count: 1,
            voices: vec![MidiVoiceDto {
                id: "voice-1".to_string(),
                label: "Voice 1".to_string(),
                note_count: 1,
                lowest_pitch: 60,
                highest_pitch: 60,
            }],
            notes: vec![note("a", "voice-1", 60, 0, 480)],
            tempo_changes: vec![TempoChangeDto {
                tick: 0,
                microseconds_per_quarter: 500_000,
            }],
            time_signatures: vec![TimeSignatureDto {
                tick: 0,
                numerator: 4,
                denominator: 4,
            }],
            warnings: Vec::new(),
            separation_summary: SeparationSummaryDto {
                mean_confidence: 1.0,
                low_confidence_note_count: 0,
                voice_count: 1,
            },
        }
    }

    fn fixture_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("fixtures")
            .join("two-note-smoke.mid")
    }

    #[test]
    fn import_midi_rejects_an_empty_path() {
        let error = import_midi("   ".to_string()).expect_err("blank path should be rejected");

        assert_eq!(error.code, AppErrorCode::EmptyPath);
    }

    #[test]
    fn import_midi_rejects_an_unsupported_extension() {
        let error =
            import_midi("song.txt".to_string()).expect_err("bad extension should be rejected");

        assert_eq!(error.code, AppErrorCode::UnsupportedFileExtension);
    }

    #[test]
    fn import_midi_reads_a_real_fixture() {
        let path = fixture_path().display().to_string();

        let imported = import_midi(path).expect("fixture should import");

        assert_eq!(imported.notes.len(), 2);
    }

    #[test]
    fn export_midi_rejects_an_empty_path() {
        let error =
            export_midi("   ".to_string(), project()).expect_err("blank path should be rejected");

        assert_eq!(error.code, AppErrorCode::EmptyPath);
    }

    #[test]
    fn export_midi_rejects_an_unsupported_extension() {
        let error = export_midi("song.txt".to_string(), project())
            .expect_err("bad extension should be rejected");

        assert_eq!(error.code, AppErrorCode::UnsupportedFileExtension);
    }

    #[test]
    fn export_midi_writes_a_file_and_reports_counts() {
        let path = std::env::temp_dir().join("chiptune-voice-separator-command-test.mid");
        let path_string = path.display().to_string();

        let result =
            export_midi(path_string, project()).expect("export should succeed for a real path");

        assert_eq!(result.note_count, 1);
        assert_eq!(result.track_count, 2);
        assert!(path.exists());

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn reassign_voices_keeps_a_locked_note_pinned_through_the_command() {
        let mut input = project();
        input.notes.push(note("b", "voice-1", 64, 480, 960));
        let locked = HashMap::from([("a".to_string(), "voice-9".to_string())]);

        let result = reassign_voices(input, locked).expect("reassignment should succeed");

        let locked_note = result
            .notes
            .iter()
            .find(|note| note.id == "a")
            .expect("locked note should still be present");
        assert_eq!(locked_note.voice_id, "voice-9");
        assert_eq!(locked_note.assignment_reason, AssignmentReason::UserLocked);
        assert_eq!(result.separation_summary.voice_count, result.voices.len());
    }
}
