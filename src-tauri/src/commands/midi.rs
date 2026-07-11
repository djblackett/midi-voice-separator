use std::{collections::HashMap, fs, path::Path};

use crate::{
    error::AppError,
    midi::{
        assignment_metric::{
            evaluate_assignment_model_cost, AssignmentEvaluationRequestDto, AssignmentMetricError,
            AssignmentMetricReportDto,
        },
        exporter::export_midi_bytes,
        model::{
            AssignmentMode, AssignmentProvenanceDto, SeparationStrategy,
            ASSIGNMENT_ALGORITHM_VERSION,
        },
        parser::{has_exported_voice_tracks, parse_midi_project},
        voice_assignment::{assign_voices_with_locks, summarize_separation_quality},
        AssignmentOperationResultDto, ExportMidiResultDto, MidiProjectDto,
    },
};

#[tauri::command]
pub fn evaluate_assignment(
    request: AssignmentEvaluationRequestDto,
) -> Result<AssignmentMetricReportDto, AppError> {
    evaluate_assignment_model_cost(&request).map_err(|error| {
        let message = match error {
            AssignmentMetricError::InvalidPpq => "Assignment cost requires a positive PPQ value.",
            AssignmentMetricError::UnsupportedProfile => {
                "The requested assignment evaluation profile is not supported."
            }
            AssignmentMetricError::CostOverflow => {
                "The assignment cost exceeds the supported numeric range."
            }
        };
        AppError::invalid_assignment_evaluation(message)
    })
}

#[tauri::command]
pub fn import_midi(path: String) -> Result<AssignmentOperationResultDto, AppError> {
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

    let project = parse_midi_project(path, &bytes).map_err(|error| {
        eprintln!("Failed to parse MIDI file '{}': {error}", path.display());
        error
    })?;

    let provenance = if has_exported_voice_tracks(&bytes) {
        AssignmentProvenanceDto::AppExportedVoiceTracks
    } else {
        AssignmentProvenanceDto::Imported {
            algorithm_version: ASSIGNMENT_ALGORITHM_VERSION,
        }
    };

    Ok(AssignmentOperationResultDto {
        project,
        provenance,
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
    max_voice_count: Option<usize>,
    strategy: SeparationStrategy,
    mode: AssignmentMode,
) -> Result<AssignmentOperationResultDto, AppError> {
    project.voices =
        assign_voices_with_locks(&mut project.notes, &locked, max_voice_count, strategy, mode);
    project.separation_summary = summarize_separation_quality(&project.notes);
    Ok(AssignmentOperationResultDto {
        project,
        provenance: AssignmentProvenanceDto::Reassigned {
            strategy,
            mode,
            max_voice_count,
            algorithm_version: ASSIGNMENT_ALGORITHM_VERSION,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppErrorCode;
    use crate::midi::assignment_metric::GENERAL_PURPOSE_PROFILE;
    use crate::midi::model::{
        AssignmentMode, AssignmentProvenanceDto, AssignmentReason, MidiNoteDto, MidiVoiceDto,
        SeparationSummaryDto, StrategySuggestionDto, TempoChangeDto, TimeSignatureDto,
        ASSIGNMENT_ALGORITHM_VERSION,
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
            strategy_suggestion: StrategySuggestionDto {
                strategy: SeparationStrategy::Balanced,
                reason: "test fixture".to_string(),
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

        assert_eq!(imported.project.notes.len(), 2);
        assert_eq!(
            imported.provenance,
            AssignmentProvenanceDto::Imported {
                algorithm_version: ASSIGNMENT_ALGORITHM_VERSION,
            }
        );
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
    fn import_midi_reports_file_not_found_for_a_missing_file() {
        let path = std::env::temp_dir().join("chiptune-voice-separator-does-not-exist.mid");
        let error =
            import_midi(path.display().to_string()).expect_err("a missing file should be rejected");

        assert_eq!(error.code, AppErrorCode::FileNotFound);
    }

    #[test]
    fn import_midi_reports_invalid_midi_for_unparsable_bytes() {
        let path = std::env::temp_dir().join("chiptune-voice-separator-garbage.mid");
        std::fs::write(&path, b"not a midi file").expect("temp file should write");

        let error =
            import_midi(path.display().to_string()).expect_err("garbage bytes should be rejected");

        assert_eq!(error.code, AppErrorCode::InvalidMidi);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn export_midi_reports_write_failed_when_the_directory_does_not_exist() {
        let path = std::env::temp_dir()
            .join("chiptune-voice-separator-missing-dir")
            .join("out.mid");

        let error = export_midi(path.display().to_string(), project())
            .expect_err("a missing parent directory should be rejected");

        assert_eq!(error.code, AppErrorCode::WriteFailed);
    }

    #[test]
    fn reassign_voices_keeps_a_locked_note_pinned_through_the_command() {
        let mut input = project();
        input.notes.push(note("b", "voice-1", 64, 480, 960));
        let locked = HashMap::from([("a".to_string(), "voice-9".to_string())]);

        let result = reassign_voices(
            input,
            locked,
            None,
            SeparationStrategy::Balanced,
            AssignmentMode::Greedy,
        )
        .expect("reassignment should succeed");

        let locked_note = result
            .project
            .notes
            .iter()
            .find(|note| note.id == "a")
            .expect("locked note should still be present");
        assert_eq!(locked_note.voice_id, "voice-9");
        assert_eq!(locked_note.assignment_reason, AssignmentReason::UserLocked);
        assert_eq!(
            result.project.separation_summary.voice_count,
            result.project.voices.len()
        );
        assert_eq!(
            result.provenance,
            AssignmentProvenanceDto::Reassigned {
                strategy: SeparationStrategy::Balanced,
                mode: AssignmentMode::Greedy,
                max_voice_count: None,
                algorithm_version: ASSIGNMENT_ALGORITHM_VERSION,
            }
        );
    }

    #[test]
    fn reassign_voices_respects_the_max_voice_count_cap_through_the_command() {
        let mut input = project();
        input.notes[0].start_tick = 0;
        input.notes[0].end_tick = 240;
        input.notes.push(note("b", "voice-1", 64, 120, 360));

        let result = reassign_voices(
            input,
            HashMap::new(),
            Some(1),
            SeparationStrategy::Balanced,
            AssignmentMode::Greedy,
        )
        .expect("reassignment should succeed");

        assert_eq!(
            result.project.notes[0].voice_id,
            result.project.notes[1].voice_id
        );
        assert_eq!(result.project.separation_summary.voice_count, 1);
        assert_eq!(
            result.provenance,
            AssignmentProvenanceDto::Reassigned {
                strategy: SeparationStrategy::Balanced,
                mode: AssignmentMode::Greedy,
                max_voice_count: Some(1),
                algorithm_version: ASSIGNMENT_ALGORITHM_VERSION,
            }
        );
    }

    #[test]
    fn reassign_voices_accepts_global_assignment_mode_through_the_command() {
        let mut input = project();
        input.notes[0].start_tick = 0;
        input.notes[0].end_tick = 240;
        input.notes.push(note("b", "voice-1", 64, 120, 360));

        let result = reassign_voices(
            input,
            HashMap::new(),
            None,
            SeparationStrategy::Balanced,
            AssignmentMode::Global,
        )
        .expect("reassignment should succeed");

        assert_eq!(
            result.project.separation_summary.voice_count,
            result.project.voices.len()
        );
        assert_eq!(
            result.provenance,
            AssignmentProvenanceDto::Reassigned {
                strategy: SeparationStrategy::Balanced,
                mode: AssignmentMode::Global,
                max_voice_count: None,
                algorithm_version: ASSIGNMENT_ALGORITHM_VERSION,
            }
        );
    }

    #[test]
    fn evaluate_assignment_returns_the_versioned_report_through_the_command() {
        let project = project();
        let result = evaluate_assignment(AssignmentEvaluationRequestDto {
            ppq: project.ppq,
            notes: project.notes,
            profile: GENERAL_PURPOSE_PROFILE,
        })
        .expect("evaluation should succeed");

        assert_eq!(result.profile, GENERAL_PURPOSE_PROFILE);
        assert_eq!(result.metric.version, 1);
        assert_eq!(result.melodic_note_count, 1);
        assert_eq!(result.total_cost, 12.0);
    }

    #[test]
    fn evaluate_assignment_maps_invalid_input_to_a_structured_error() {
        let error = evaluate_assignment(AssignmentEvaluationRequestDto {
            ppq: 0,
            notes: Vec::new(),
            profile: GENERAL_PURPOSE_PROFILE,
        })
        .expect_err("zero PPQ should be rejected");

        assert_eq!(error.code, AppErrorCode::InvalidAssignmentEvaluation);
        assert_eq!(
            error.message,
            "Assignment cost requires a positive PPQ value."
        );
    }
}

#[cfg(test)]
mod workflow_integration_tests {
    use super::{export_midi, import_midi, reassign_voices};
    use crate::midi::model::{AssignmentMode, SeparationStrategy};
    use std::{
        collections::HashMap,
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn fixture_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("fixtures")
            .join("two-note-smoke.mid")
    }

    fn unique_export_path() -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after Unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("chiptune-voice-separator-workflow-{nonce}.mid"))
    }

    #[test]
    fn command_workflow_imports_reassigns_exports_and_reimports_a_real_file() {
        let imported = import_midi(fixture_path().display().to_string())
            .expect("fixture should import through the production command");
        let locked_note = imported.project.notes[0].id.clone();
        let locked_voice = imported.project.notes[0].voice_id.clone();
        let reassigned = reassign_voices(
            imported.project,
            HashMap::from([(locked_note.clone(), locked_voice.clone())]),
            None,
            SeparationStrategy::Balanced,
            AssignmentMode::Greedy,
        )
        .expect("reassignment should succeed through the production command");
        assert_eq!(
            reassigned
                .project
                .notes
                .iter()
                .find(|note| note.id == locked_note)
                .expect("locked note should remain present")
                .voice_id,
            locked_voice
        );

        let output = unique_export_path();
        let export_result = export_midi(output.display().to_string(), reassigned.project)
            .expect("workflow export should succeed through the production command");
        let reimported = import_midi(export_result.path)
            .expect("workflow export should reimport through the production command");
        assert_eq!(reimported.project.notes.len(), 2);
        assert_eq!(
            reimported.provenance,
            crate::midi::model::AssignmentProvenanceDto::AppExportedVoiceTracks
        );
        assert!(reimported
            .project
            .notes
            .iter()
            .all(|note| !note.voice_id.is_empty()));
        fs::remove_file(output).expect("workflow export should be removable");
    }
}
