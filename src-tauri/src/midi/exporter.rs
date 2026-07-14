use std::collections::HashSet;

use midly::{
    num::{u15, u24, u28, u4, u7},
    Format, Header, MetaMessage, MidiMessage, Smf, Timing, TrackEvent, TrackEventKind,
};

use crate::error::AppError;

use super::{
    export_validation::validate_export_project, model::MidiProjectDto, EXPORTED_VOICE_TRACK_MARKER,
};

const MAX_MIDI_DELTA: u64 = 0x0fff_ffff;

#[derive(Debug, Clone)]
struct AbsoluteEvent {
    tick: u64,
    order: u8,
    note_id: String,
    kind: TrackEventKind<'static>,
}

pub fn export_midi_bytes(project: &MidiProjectDto) -> Result<Vec<u8>, AppError> {
    let smf = build_export_smf(project)?;
    let mut bytes = Vec::new();
    smf.write_std(&mut bytes)
        .map_err(|_| AppError::from_write_io(&std::io::Error::other("failed to encode MIDI")))?;
    Ok(bytes)
}

fn build_export_smf(project: &MidiProjectDto) -> Result<Smf<'_>, AppError> {
    // The encoder must never silently clamp or reorder a materialized editor
    // project. Keep this at the shared builder boundary so every byte-export
    // caller receives the same validation, not only the Tauri command.
    let _preflight = validate_export_project(project)?;
    let mut tracks: Vec<Vec<TrackEvent<'_>>> = vec![build_conductor_track(project)?];
    let voice_ids: HashSet<&str> = project
        .voices
        .iter()
        .map(|voice| voice.id.as_str())
        .collect();

    for voice in &project.voices {
        let voice_notes = project
            .notes
            .iter()
            .filter(|note| note.voice_id == voice.id)
            .collect::<Vec<_>>();
        tracks.push(build_voice_track(
            &voice_notes,
            project.duration_ticks,
            voice.label.as_bytes(),
        )?);
    }

    let unlisted_voice_notes = project
        .notes
        .iter()
        .filter(|note| !voice_ids.contains(note.voice_id.as_str()))
        .collect::<Vec<_>>();
    if !unlisted_voice_notes.is_empty() {
        tracks.push(build_voice_track(
            &unlisted_voice_notes,
            project.duration_ticks,
            b"Unassigned",
        )?);
    }

    Ok(Smf {
        header: Header {
            format: Format::Parallel,
            timing: Timing::Metrical(u15::new(project.ppq)),
        },
        tracks,
    })
}

fn build_conductor_track(project: &MidiProjectDto) -> Result<Vec<TrackEvent<'static>>, AppError> {
    let mut events = Vec::new();

    for tempo_change in &project.tempo_changes {
        events.push(AbsoluteEvent {
            tick: tempo_change.tick,
            order: 0,
            note_id: String::new(),
            kind: TrackEventKind::Meta(MetaMessage::Tempo(u24::new(
                tempo_change.microseconds_per_quarter,
            ))),
        });
    }

    for time_signature in &project.time_signatures {
        events.push(AbsoluteEvent {
            tick: time_signature.tick,
            order: 1,
            note_id: String::new(),
            kind: TrackEventKind::Meta(MetaMessage::TimeSignature(
                time_signature.numerator,
                denominator_power(time_signature.denominator),
                24,
                8,
            )),
        });
    }

    events_to_track(events, project.duration_ticks)
}

fn build_voice_track<'a>(
    notes: &[&super::model::MidiNoteDto],
    duration_ticks: u64,
    label: &'a [u8],
) -> Result<Vec<TrackEvent<'a>>, AppError> {
    let mut events = Vec::new();

    for note in notes {
        events.push(AbsoluteEvent {
            tick: note.start_tick,
            order: 1,
            note_id: note.id.clone(),
            kind: TrackEventKind::Midi {
                channel: u4::new(note.channel.min(15)),
                message: MidiMessage::NoteOn {
                    key: u7::new(note.pitch.min(127)),
                    vel: u7::new(note.velocity.min(127)),
                },
            },
        });
        events.push(AbsoluteEvent {
            tick: note.end_tick,
            order: 0,
            note_id: note.id.clone(),
            kind: TrackEventKind::Midi {
                channel: u4::new(note.channel.min(15)),
                message: MidiMessage::NoteOff {
                    key: u7::new(note.pitch.min(127)),
                    vel: u7::new(0),
                },
            },
        });
    }

    // The `Text` marker is how reimport recognizes an app-exported voice
    // track; the `TrackName` carries the real voice label so exports open
    // with meaningful names in any DAW and round-trip labels back into
    // this app.
    let mut track = vec![
        TrackEvent {
            delta: u28::new(0),
            kind: TrackEventKind::Meta(MetaMessage::Text(EXPORTED_VOICE_TRACK_MARKER)),
        },
        TrackEvent {
            delta: u28::new(0),
            kind: TrackEventKind::Meta(MetaMessage::TrackName(label)),
        },
    ];
    track.extend(events_to_track(events, duration_ticks)?);

    Ok(track)
}

fn events_to_track(
    mut events: Vec<AbsoluteEvent>,
    duration_ticks: u64,
) -> Result<Vec<TrackEvent<'static>>, AppError> {
    events.sort_by(|left, right| {
        left.tick
            .cmp(&right.tick)
            .then(left.order.cmp(&right.order))
            .then(left.note_id.cmp(&right.note_id))
    });

    let mut track = Vec::new();
    let mut last_tick = 0_u64;

    for event in events {
        let delta = event.tick.saturating_sub(last_tick);
        track.push(TrackEvent {
            delta: delta_to_u28(delta)?,
            kind: event.kind,
        });
        last_tick = event.tick;
    }

    let end_tick = duration_ticks.max(last_tick);
    track.push(TrackEvent {
        delta: delta_to_u28(end_tick.saturating_sub(last_tick))?,
        kind: TrackEventKind::Meta(MetaMessage::EndOfTrack),
    });

    Ok(track)
}

fn delta_to_u28(delta: u64) -> Result<u28, AppError> {
    if delta > MAX_MIDI_DELTA {
        return Err(AppError::export_timing_out_of_range());
    }

    Ok(u28::new(delta as u32))
}

fn denominator_power(denominator: u8) -> u8 {
    if denominator.is_power_of_two() {
        denominator.trailing_zeros() as u8
    } else {
        2
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::midi::content_matching::MatchDocument;
    use crate::midi::model::{
        AssignmentReason, MidiNoteDto, MidiProjectDto, MidiVoiceDto, SeparationStrategy,
        SeparationSummaryDto, StrategySuggestionDto, TempoChangeDto, TimeSignatureDto,
        VoiceRoleDto,
    };
    use crate::midi::parser::parse_midi_project;
    use crate::midi::round_trip_verification::{
        strict_round_trip_verification_dto, verify_strict_note_content,
    };
    use std::path::Path;

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
            voices: vec![
                MidiVoiceDto {
                    id: "voice-1".to_string(),
                    label: "Voice 1".to_string(),
                    role: VoiceRoleDto::Melodic,
                    note_count: 1,
                    lowest_pitch: 60,
                    highest_pitch: 60,
                },
                MidiVoiceDto {
                    id: "voice-2".to_string(),
                    label: "Voice 2".to_string(),
                    role: VoiceRoleDto::Melodic,
                    note_count: 1,
                    lowest_pitch: 72,
                    highest_pitch: 72,
                },
            ],
            notes: vec![
                note("a", "voice-1", 60, 0, 480),
                note("b", "voice-2", 72, 240, 960),
            ],
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
                voice_count: 2,
            },
            strategy_suggestion: StrategySuggestionDto {
                strategy: SeparationStrategy::Balanced,
                reason: "test fixture".to_string(),
            },
        }
    }

    #[test]
    fn writes_conductor_plus_one_track_per_voice() {
        let project = project();
        let smf = build_export_smf(&project).expect("project should export");

        assert_eq!(smf.header.format, Format::Parallel);
        assert_eq!(smf.tracks.len(), 3);
    }

    #[test]
    fn writes_voice_events_as_delta_times() {
        let project = project();
        let smf = build_export_smf(&project).expect("project should export");
        let first_voice_track = &smf.tracks[1];

        assert_eq!(first_voice_track[0].delta.as_int(), 0);
        assert!(matches!(
            first_voice_track[0].kind,
            TrackEventKind::Meta(MetaMessage::Text(EXPORTED_VOICE_TRACK_MARKER))
        ));
        assert!(matches!(
            first_voice_track[1].kind,
            TrackEventKind::Meta(MetaMessage::TrackName(name)) if name == b"Voice 1"
        ));
        assert_eq!(first_voice_track[2].delta.as_int(), 0);
        assert_eq!(first_voice_track[3].delta.as_int(), 480);
        assert_eq!(first_voice_track[4].delta.as_int(), 480);
    }

    #[test]
    fn exports_voice_labels_as_track_names_and_reimports_them() {
        let mut project = project();
        project.voices[0].label = "Lead".to_string();
        project.voices[1].label = "Bass".to_string();

        let bytes = export_midi_bytes(&project).expect("project should export");
        let imported = parse_midi_project(Path::new("labels.mid"), &bytes)
            .expect("exported MIDI should reimport");

        assert_eq!(imported.voices.len(), 2);
        assert_eq!(imported.voices[0].label, "Lead");
        assert_eq!(imported.voices[1].label, "Bass");
    }

    #[test]
    fn preserves_exported_voice_assignments_when_reimported() {
        let mut project = project();
        project.notes[0].voice_id = "voice-2".to_string();
        project.notes[1].voice_id = "voice-1".to_string();

        let bytes = export_midi_bytes(&project).expect("project should export");
        let imported = parse_midi_project(Path::new("roundtrip.mid"), &bytes)
            .expect("exported MIDI should reimport");

        let low_note = imported
            .notes
            .iter()
            .find(|note| note.pitch == 60)
            .expect("low note should import");
        let high_note = imported
            .notes
            .iter()
            .find(|note| note.pitch == 72)
            .expect("high note should import");

        assert_eq!(low_note.voice_id, "voice-2");
        assert_eq!(high_note.voice_id, "voice-1");
    }

    #[test]
    fn includes_tempo_and_time_signature_events() {
        let project = project();
        let smf = build_export_smf(&project).expect("project should export");
        let conductor = &smf.tracks[0];

        assert!(matches!(
            conductor[0].kind,
            TrackEventKind::Meta(MetaMessage::Tempo(_))
        ));
        assert!(matches!(
            conductor[1].kind,
            TrackEventKind::Meta(MetaMessage::TimeSignature(4, 2, 24, 8))
        ));
    }

    #[test]
    fn rejects_delta_times_that_cannot_fit_midi() {
        let mut project = project();
        project.duration_ticks = MAX_MIDI_DELTA + 1;

        let error = build_export_smf(&project).expect_err("large delta should fail");

        assert_eq!(
            error.code,
            crate::error::AppErrorCode::ExportTimingOutOfRange
        );
    }

    #[test]
    fn rejects_invalid_project_values_before_encoding_them() {
        let mut project = project();
        project.notes[0].channel = 16;

        let error = export_midi_bytes(&project).expect_err("invalid channel should be rejected");

        assert_eq!(error.code, crate::error::AppErrorCode::InvalidExportProject);
    }

    fn strict_content_report(
        project: &MidiProjectDto,
    ) -> crate::midi::model::StrictRoundTripVerificationDto {
        let bytes = export_midi_bytes(project).expect("project should export");
        let reimported = parse_midi_project(Path::new("round-trip.mid"), &bytes)
            .expect("exported MIDI should reimport");
        strict_round_trip_verification_dto(
            &verify_strict_note_content(
                MatchDocument {
                    document_id: "expected-export",
                    ppq: project.ppq,
                    notes: &project.notes,
                },
                MatchDocument {
                    document_id: "reimported-export",
                    ppq: reimported.ppq,
                    notes: &reimported.notes,
                },
            )
            .expect("exported MIDI should have well-formed note timing"),
        )
    }

    #[test]
    fn round_trip_inventory_preserves_normal_content_and_timeline_metadata() {
        let project = project();
        let bytes = export_midi_bytes(&project).expect("project should export");
        let reimported = parse_midi_project(Path::new("normal-round-trip.mid"), &bytes)
            .expect("exported MIDI should reimport");

        assert!(strict_content_report(&project).content_preserved);
        assert_eq!(reimported.ppq, project.ppq);
        assert_eq!(reimported.duration_ticks, project.duration_ticks);
        assert_eq!(reimported.tempo_changes, project.tempo_changes);
        assert_eq!(reimported.time_signatures, project.time_signatures);
    }

    #[test]
    fn round_trip_inventory_marks_zero_length_content_as_a_difference_target() {
        let mut project = project();
        project.notes = vec![note("zero", "voice-1", 60, 240, 240)];
        project.voices.truncate(1);

        let report = strict_content_report(&project);

        assert!(!report.content_preserved);
        assert_eq!(report.missing_expected.len(), 1);
        assert_eq!(report.unexpected_reimported.len(), 1);
    }

    #[test]
    fn round_trip_inventory_marks_crossing_duplicate_notes_as_a_difference_target() {
        let mut project = project();
        project.duration_ticks = 20;
        project.voices.truncate(1);
        project.notes = vec![
            note("first", "voice-1", 60, 0, 20),
            note("second", "voice-1", 60, 10, 15),
        ];

        let report = strict_content_report(&project);

        assert!(!report.content_preserved);
        assert_eq!(report.missing_expected.len(), 2);
        assert_eq!(report.unexpected_reimported.len(), 2);
    }

    #[test]
    fn round_trip_inventory_marks_empty_exported_voices_as_a_partition_difference_target() {
        let mut project = project();
        project.notes.truncate(1);

        let bytes = export_midi_bytes(&project).expect("project should export");
        let reimported = parse_midi_project(Path::new("empty-voice.mid"), &bytes)
            .expect("exported MIDI should reimport");

        assert!(strict_content_report(&project).content_preserved);
        assert_eq!(project.voices.len(), 2);
        assert_eq!(reimported.voices.len(), 1);
    }

    #[test]
    fn round_trip_inventory_preserves_percussion_role_despite_parser_local_id_change() {
        let mut project = project();
        project.voices.truncate(1);
        project.voices[0].id = "percussion".to_string();
        project.voices[0].label = "Percussion".to_string();
        project.notes = vec![MidiNoteDto {
            channel: 9,
            pitch: 36,
            ..note("kick", "percussion", 36, 0, 480)
        }];

        let bytes = export_midi_bytes(&project).expect("project should export");
        let reimported = parse_midi_project(Path::new("percussion.mid"), &bytes)
            .expect("exported MIDI should reimport");

        assert!(strict_content_report(&project).content_preserved);
        assert_eq!(reimported.voices[0].label, "Percussion");
        assert_eq!(reimported.voices[0].role, VoiceRoleDto::Percussion);
        assert_ne!(reimported.voices[0].id, "percussion");
    }

    #[test]
    fn round_trip_inventory_marks_duplicate_labels_as_a_difference_target() {
        let mut project = project();
        project.voices[0].label = "Square".to_string();
        project.voices[1].label = "Square".to_string();

        let bytes = export_midi_bytes(&project).expect("project should export");
        let reimported = parse_midi_project(Path::new("duplicate-labels.mid"), &bytes)
            .expect("exported MIDI should reimport");

        let labels = reimported
            .voices
            .iter()
            .map(|voice| voice.label.as_str())
            .collect::<Vec<_>>();
        assert_eq!(labels, vec!["Square", "Square 2"]);
    }

    #[test]
    fn round_trip_inventory_emits_an_extra_track_for_unlisted_voice_notes() {
        let mut project = project();
        project
            .notes
            .push(note("unlisted", "not-listed", 67, 480, 960));

        let smf = build_export_smf(&project).expect("project should export");

        assert_eq!(smf.tracks.len(), project.voices.len() + 2);
    }
}
