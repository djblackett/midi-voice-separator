use std::collections::{BTreeMap, BTreeSet};

use crate::error::AppError;

use super::model::{MidiNoteDto, MidiProjectDto};

/// MIDI's metrical timing field is an unsigned 15-bit value.
pub(crate) const MAX_EXPORT_PPQ: u16 = 0x7fff;
/// MIDI tempo meta events store microseconds per quarter note as an unsigned
/// 24-bit value.
pub(crate) const MAX_EXPORT_TEMPO_MICROSECONDS_PER_QUARTER: u32 = 0x00ff_ffff;

/// Non-fatal facts about how the exporter has to materialize a project.
/// They become structured round-trip report categories when the command layer
/// writes and verifies the actual destination file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ExportProjectPreflight {
    /// Distinct note voice IDs that are absent from `project.voices`. The
    /// exporter intentionally groups these notes into one `Unassigned` track.
    pub unlisted_voice_ids: Vec<String>,
    /// Same-track repeated note-ons whose crossing note-offs cannot be
    /// recovered from standard MIDI events without an invented occurrence
    /// identity.
    pub crossing_duplicate_overlaps: Vec<CrossingDuplicateOverlap>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CrossingDuplicateOverlap {
    /// The note that starts earlier and ends later.
    pub first_note_id: String,
    pub first_voice_id: String,
    /// The note that starts later and ends earlier.
    pub second_note_id: String,
    pub second_voice_id: String,
    pub channel: u8,
    pub pitch: u8,
}

/// Rejects materialized project values the exporter would otherwise clamp,
/// coerce, or reorder into a different supported model. Valid-but-inherently
/// ambiguous MIDI shapes are returned as diagnostics instead of an error.
pub(crate) fn validate_export_project(
    project: &MidiProjectDto,
) -> Result<ExportProjectPreflight, AppError> {
    validate_ppq(project)?;
    validate_voice_metadata(project)?;
    validate_note_metadata(project)?;
    validate_timeline_metadata(project)?;

    let listed_voice_ids: BTreeSet<&str> = project
        .voices
        .iter()
        .map(|voice| voice.id.as_str())
        .collect();
    Ok(ExportProjectPreflight {
        unlisted_voice_ids: project
            .notes
            .iter()
            .filter(|note| !listed_voice_ids.contains(note.voice_id.as_str()))
            .map(|note| note.voice_id.clone())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect(),
        crossing_duplicate_overlaps: crossing_duplicate_overlaps(project, &listed_voice_ids),
    })
}

fn validate_ppq(project: &MidiProjectDto) -> Result<(), AppError> {
    if project.ppq == 0 || project.ppq > MAX_EXPORT_PPQ {
        return Err(AppError::invalid_export_project(format!(
            "Export PPQ must be between 1 and {MAX_EXPORT_PPQ}; received {}.",
            project.ppq
        )));
    }
    Ok(())
}

fn validate_voice_metadata(project: &MidiProjectDto) -> Result<(), AppError> {
    if project
        .voices
        .iter()
        .any(|voice| voice.id.trim().is_empty())
    {
        return Err(AppError::invalid_export_project(
            "Export voice IDs must not be empty.",
        ));
    }
    if let Some(voice_id) = duplicate_value(project.voices.iter().map(|voice| voice.id.as_str())) {
        return Err(AppError::invalid_export_project(format!(
            "Export voice ID '{voice_id}' is duplicated.",
        )));
    }
    Ok(())
}

fn validate_note_metadata(project: &MidiProjectDto) -> Result<(), AppError> {
    if project.notes.iter().any(|note| note.id.trim().is_empty()) {
        return Err(AppError::invalid_export_project(
            "Export note IDs must not be empty.",
        ));
    }
    if let Some(note_id) = duplicate_value(project.notes.iter().map(|note| note.id.as_str())) {
        return Err(AppError::invalid_export_project(format!(
            "Export note ID '{note_id}' is duplicated.",
        )));
    }

    let mut notes = project.notes.iter().collect::<Vec<_>>();
    notes.sort_by(|left, right| left.id.cmp(&right.id));
    for note in notes {
        if note.voice_id.trim().is_empty() {
            return Err(AppError::invalid_export_project(format!(
                "Export note '{}' has an empty voice ID.",
                note.id
            )));
        }
        if note.end_tick < note.start_tick {
            return Err(AppError::invalid_export_project(format!(
                "Export note '{}' ends at tick {} before it starts at tick {}.",
                note.id, note.end_tick, note.start_tick
            )));
        }
        if note.end_tick > project.duration_ticks {
            return Err(AppError::invalid_export_project(format!(
                "Export note '{}' ends at tick {}, beyond project duration {}.",
                note.id, note.end_tick, project.duration_ticks
            )));
        }
        if note.channel > 15 {
            return Err(AppError::invalid_export_project(format!(
                "Export note '{}' has channel {}; MIDI channels must be 0 through 15.",
                note.id, note.channel
            )));
        }
        if note.pitch > 127 {
            return Err(AppError::invalid_export_project(format!(
                "Export note '{}' has pitch {}; MIDI pitches must be 0 through 127.",
                note.id, note.pitch
            )));
        }
        if note.velocity > 127 {
            return Err(AppError::invalid_export_project(format!(
                "Export note '{}' has velocity {}; MIDI velocities must be 0 through 127.",
                note.id, note.velocity
            )));
        }
    }
    Ok(())
}

fn validate_timeline_metadata(project: &MidiProjectDto) -> Result<(), AppError> {
    let mut previous_tempo_tick = None;
    for tempo in &project.tempo_changes {
        if tempo.tick > project.duration_ticks {
            return Err(AppError::invalid_export_project(format!(
                "Tempo change at tick {} is beyond project duration {}.",
                tempo.tick, project.duration_ticks
            )));
        }
        if previous_tempo_tick.is_some_and(|previous_tick| tempo.tick < previous_tick) {
            return Err(AppError::invalid_export_project(
                "Tempo changes must be ordered by non-decreasing tick.",
            ));
        }
        if tempo.microseconds_per_quarter == 0
            || tempo.microseconds_per_quarter > MAX_EXPORT_TEMPO_MICROSECONDS_PER_QUARTER
        {
            return Err(AppError::invalid_export_project(format!(
                "Tempo at tick {} must be between 1 and {MAX_EXPORT_TEMPO_MICROSECONDS_PER_QUARTER} microseconds per quarter note.",
                tempo.tick
            )));
        }
        previous_tempo_tick = Some(tempo.tick);
    }

    let mut previous_time_signature_tick = None;
    for time_signature in &project.time_signatures {
        if time_signature.tick > project.duration_ticks {
            return Err(AppError::invalid_export_project(format!(
                "Time signature at tick {} is beyond project duration {}.",
                time_signature.tick, project.duration_ticks
            )));
        }
        if previous_time_signature_tick
            .is_some_and(|previous_tick| time_signature.tick < previous_tick)
        {
            return Err(AppError::invalid_export_project(
                "Time signatures must be ordered by non-decreasing tick.",
            ));
        }
        if time_signature.numerator == 0 {
            return Err(AppError::invalid_export_project(format!(
                "Time signature at tick {} must have a positive numerator.",
                time_signature.tick
            )));
        }
        if time_signature.denominator == 0 || !time_signature.denominator.is_power_of_two() {
            return Err(AppError::invalid_export_project(format!(
                "Time signature at tick {} has denominator {}; it must be a positive power of two.",
                time_signature.tick, time_signature.denominator
            )));
        }
        previous_time_signature_tick = Some(time_signature.tick);
    }
    Ok(())
}

fn duplicate_value<'a>(values: impl IntoIterator<Item = &'a str>) -> Option<String> {
    let mut counts = BTreeMap::<&str, usize>::new();
    for value in values {
        *counts.entry(value).or_default() += 1;
    }
    counts
        .into_iter()
        .find_map(|(value, count)| (count > 1).then(|| value.to_string()))
}

fn crossing_duplicate_overlaps(
    project: &MidiProjectDto,
    listed_voice_ids: &BTreeSet<&str>,
) -> Vec<CrossingDuplicateOverlap> {
    let mut groups = BTreeMap::<(String, u8, u8), Vec<&MidiNoteDto>>::new();
    for note in &project.notes {
        // Listed voices map to distinct exported tracks. All unlisted voice
        // IDs intentionally share the single fallback `Unassigned` track.
        let export_track_key = if listed_voice_ids.contains(note.voice_id.as_str()) {
            format!("listed:{}", note.voice_id)
        } else {
            "unlisted".to_string()
        };
        groups
            .entry((export_track_key, note.channel, note.pitch))
            .or_default()
            .push(note);
    }

    let mut overlaps = Vec::new();
    for ((_, channel, pitch), mut notes) in groups {
        notes.sort_by(|left, right| {
            left.start_tick
                .cmp(&right.start_tick)
                .then(left.end_tick.cmp(&right.end_tick))
                .then(left.id.cmp(&right.id))
        });
        for (index, first) in notes.iter().enumerate() {
            for second in notes.iter().skip(index + 1) {
                if first.start_tick < second.start_tick && second.end_tick < first.end_tick {
                    overlaps.push(CrossingDuplicateOverlap {
                        first_note_id: first.id.clone(),
                        first_voice_id: first.voice_id.clone(),
                        second_note_id: second.id.clone(),
                        second_voice_id: second.voice_id.clone(),
                        channel,
                        pitch,
                    });
                }
            }
        }
    }
    overlaps
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        error::AppErrorCode,
        midi::model::{
            AssignmentReason, MidiVoiceDto, SeparationStrategy, SeparationSummaryDto,
            StrategySuggestionDto, TempoChangeDto, TimeSignatureDto, VoiceRoleDto,
        },
    };

    fn note(id: &str, voice_id: &str, start_tick: u64, end_tick: u64) -> MidiNoteDto {
        MidiNoteDto {
            id: id.to_string(),
            voice_id: voice_id.to_string(),
            source_track_index: 0,
            channel: 0,
            pitch: 60,
            velocity: 100,
            start_tick,
            end_tick,
            duration_ticks: end_tick.saturating_sub(start_tick),
            assignment_confidence: 1.0,
            assignment_reason: AssignmentReason::Imported,
        }
    }

    fn voice(id: &str) -> MidiVoiceDto {
        MidiVoiceDto {
            id: id.to_string(),
            label: id.to_string(),
            role: VoiceRoleDto::Melodic,
            note_count: 1,
            lowest_pitch: 60,
            highest_pitch: 60,
        }
    }

    fn project() -> MidiProjectDto {
        MidiProjectDto {
            file_name: "validation.mid".to_string(),
            format: "parallel".to_string(),
            ppq: 480,
            duration_ticks: 960,
            track_count: 2,
            voices: vec![voice("voice-1")],
            notes: vec![note("a", "voice-1", 0, 480)],
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

    #[test]
    fn accepts_supported_materialized_project() {
        assert_eq!(
            validate_export_project(&project()).expect("project should be valid"),
            ExportProjectPreflight {
                unlisted_voice_ids: Vec::new(),
                crossing_duplicate_overlaps: Vec::new(),
            }
        );
    }

    #[test]
    fn retains_valid_edge_cases_for_later_export_fidelity_repairs() {
        let mut candidate = project();
        candidate.notes[0].end_tick = candidate.notes[0].start_tick;
        candidate.notes[0].duration_ticks = 0;
        let mut empty_duplicate_label_voice = voice("voice-2");
        empty_duplicate_label_voice.label = candidate.voices[0].label.clone();
        empty_duplicate_label_voice.note_count = 0;
        empty_duplicate_label_voice.lowest_pitch = 0;
        empty_duplicate_label_voice.highest_pitch = 0;
        candidate.voices.push(empty_duplicate_label_voice);

        let preflight = validate_export_project(&candidate)
            .expect("zero-length notes and empty duplicate-labeled voices stay valid");

        assert!(preflight.unlisted_voice_ids.is_empty());
        assert!(preflight.crossing_duplicate_overlaps.is_empty());
    }

    #[test]
    fn rejects_ppq_outside_midi_metrical_range() {
        for ppq in [0, MAX_EXPORT_PPQ + 1] {
            let mut invalid = project();
            invalid.ppq = ppq;

            let error = validate_export_project(&invalid).expect_err("PPQ should be rejected");

            assert_eq!(error.code, AppErrorCode::InvalidExportProject);
        }
    }

    #[test]
    fn rejects_note_values_that_the_encoder_would_clamp_or_reinterpret() {
        let cases: Vec<(&str, Box<dyn Fn(&mut MidiProjectDto)>)> = vec![
            (
                "end before start",
                Box::new(|project| project.notes[0].end_tick = 0),
            ),
            (
                "end after duration",
                Box::new(|project| project.notes[0].end_tick = 961),
            ),
            ("channel", Box::new(|project| project.notes[0].channel = 16)),
            ("pitch", Box::new(|project| project.notes[0].pitch = 128)),
            (
                "velocity",
                Box::new(|project| project.notes[0].velocity = 128),
            ),
        ];
        for (name, mutate) in cases {
            let mut invalid = project();
            mutate(&mut invalid);
            if name == "end before start" {
                invalid.notes[0].start_tick = 1;
            }

            let error = validate_export_project(&invalid).expect_err(name);

            assert_eq!(error.code, AppErrorCode::InvalidExportProject, "{name}");
        }
    }

    #[test]
    fn rejects_duplicate_or_malformed_voice_and_note_addresses() {
        let cases: Vec<(&str, Box<dyn Fn(&mut MidiProjectDto)>)> = vec![
            (
                "empty voice",
                Box::new(|project| project.voices[0].id.clear()),
            ),
            (
                "duplicate voice",
                Box::new(|project| project.voices.push(voice("voice-1"))),
            ),
            (
                "empty note",
                Box::new(|project| project.notes[0].id.clear()),
            ),
            (
                "duplicate note",
                Box::new(|project| project.notes.push(note("a", "voice-1", 480, 960))),
            ),
            (
                "empty note voice",
                Box::new(|project| project.notes[0].voice_id.clear()),
            ),
        ];
        for (name, mutate) in cases {
            let mut invalid = project();
            mutate(&mut invalid);

            let error = validate_export_project(&invalid).expect_err(name);

            assert_eq!(error.code, AppErrorCode::InvalidExportProject, "{name}");
        }
    }

    #[test]
    fn rejects_timeline_metadata_that_would_be_coerced_or_reordered() {
        let cases: Vec<(&str, Box<dyn Fn(&mut MidiProjectDto)>)> = vec![
            (
                "zero tempo",
                Box::new(|project| project.tempo_changes[0].microseconds_per_quarter = 0),
            ),
            (
                "large tempo",
                Box::new(|project| {
                    project.tempo_changes[0].microseconds_per_quarter =
                        MAX_EXPORT_TEMPO_MICROSECONDS_PER_QUARTER + 1
                }),
            ),
            (
                "unordered tempo",
                Box::new(|project| {
                    project.tempo_changes = vec![
                        TempoChangeDto {
                            tick: 480,
                            microseconds_per_quarter: 500_000,
                        },
                        TempoChangeDto {
                            tick: 240,
                            microseconds_per_quarter: 400_000,
                        },
                    ]
                }),
            ),
            (
                "invalid denominator",
                Box::new(|project| project.time_signatures[0].denominator = 3),
            ),
            (
                "zero numerator",
                Box::new(|project| project.time_signatures[0].numerator = 0),
            ),
        ];
        for (name, mutate) in cases {
            let mut invalid = project();
            mutate(&mut invalid);

            let error = validate_export_project(&invalid).expect_err(name);

            assert_eq!(error.code, AppErrorCode::InvalidExportProject, "{name}");
        }
    }

    #[test]
    fn reports_sorted_unlisted_voice_ids_without_rejecting_export() {
        let mut candidate = project();
        candidate.notes.extend([
            note("orphan-b", "orphan-b", 480, 720),
            note("orphan-a", "orphan-a", 720, 960),
        ]);

        let preflight = validate_export_project(&candidate).expect("unlisted voices are supported");

        assert_eq!(
            preflight.unlisted_voice_ids,
            vec!["orphan-a".to_string(), "orphan-b".to_string()]
        );
    }

    #[test]
    fn reports_crossing_duplicate_note_pairs_only_when_the_export_track_is_shared() {
        let mut candidate = project();
        candidate.notes = vec![
            note("outer", "voice-1", 0, 600),
            note("inner", "voice-1", 120, 480),
            note("other-track", "voice-2", 120, 480),
        ];
        candidate.voices.push(voice("voice-2"));

        let preflight = validate_export_project(&candidate).expect("shape is valid but ambiguous");

        assert_eq!(
            preflight.crossing_duplicate_overlaps,
            vec![CrossingDuplicateOverlap {
                first_note_id: "outer".to_string(),
                first_voice_id: "voice-1".to_string(),
                second_note_id: "inner".to_string(),
                second_voice_id: "voice-1".to_string(),
                channel: 0,
                pitch: 60,
            }]
        );
    }

    #[test]
    fn detects_crossing_duplicates_from_different_unlisted_ids_in_the_shared_fallback_track() {
        let mut candidate = project();
        candidate.notes = vec![
            note("outer", "unlisted-a", 0, 600),
            note("inner", "unlisted-b", 120, 480),
        ];

        let preflight = validate_export_project(&candidate).expect("shape is valid but ambiguous");

        assert_eq!(
            preflight.crossing_duplicate_overlaps,
            vec![CrossingDuplicateOverlap {
                first_note_id: "outer".to_string(),
                first_voice_id: "unlisted-a".to_string(),
                second_note_id: "inner".to_string(),
                second_voice_id: "unlisted-b".to_string(),
                channel: 0,
                pitch: 60,
            }]
        );
    }
}
