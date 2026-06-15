use std::collections::HashSet;

use midly::{
    num::{u15, u24, u28, u4, u7},
    Format, Header, MetaMessage, MidiMessage, Smf, Timing, TrackEvent, TrackEventKind,
};

use crate::error::AppError;

use super::model::MidiProjectDto;

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

fn build_export_smf(project: &MidiProjectDto) -> Result<Smf<'static>, AppError> {
    let mut tracks = vec![build_conductor_track(project)?];
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
        tracks.push(build_voice_track(&voice_notes, project.duration_ticks)?);
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

fn build_voice_track(
    notes: &[&super::model::MidiNoteDto],
    duration_ticks: u64,
) -> Result<Vec<TrackEvent<'static>>, AppError> {
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

    events_to_track(events, duration_ticks)
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
    use crate::midi::model::{
        MidiNoteDto, MidiProjectDto, MidiVoiceDto, TempoChangeDto, TimeSignatureDto,
    };

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
                    note_count: 1,
                    lowest_pitch: 60,
                    highest_pitch: 60,
                },
                MidiVoiceDto {
                    id: "voice-2".to_string(),
                    label: "Voice 2".to_string(),
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
        }
    }

    #[test]
    fn writes_conductor_plus_one_track_per_voice() {
        let smf = build_export_smf(&project()).expect("project should export");

        assert_eq!(smf.header.format, Format::Parallel);
        assert_eq!(smf.tracks.len(), 3);
    }

    #[test]
    fn writes_voice_events_as_delta_times() {
        let smf = build_export_smf(&project()).expect("project should export");
        let first_voice_track = &smf.tracks[1];

        assert_eq!(first_voice_track[0].delta.as_int(), 0);
        assert_eq!(first_voice_track[1].delta.as_int(), 480);
        assert_eq!(first_voice_track[2].delta.as_int(), 480);
    }

    #[test]
    fn includes_tempo_and_time_signature_events() {
        let smf = build_export_smf(&project()).expect("project should export");
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
}
