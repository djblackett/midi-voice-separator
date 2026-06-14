use std::{
    collections::{HashMap, VecDeque},
    path::Path,
};

use midly::{Format, MetaMessage, MidiMessage, Smf, Timing, TrackEventKind};

use crate::error::AppError;

use super::model::{
    MidiNoteDto, MidiProjectDto, MidiWarningCode, MidiWarningDto, TempoChangeDto, TimeSignatureDto,
};

#[derive(Debug, Clone)]
struct ActiveNote {
    start_tick: u64,
    velocity: u8,
    sequence: u64,
}

#[derive(Debug, Clone, Copy, Hash, PartialEq, Eq)]
struct NoteKey {
    channel: u8,
    pitch: u8,
}

pub fn parse_midi_project(path: &Path, bytes: &[u8]) -> Result<MidiProjectDto, AppError> {
    let smf = Smf::parse(bytes).map_err(|_| AppError::invalid_midi())?;
    let ppq = match smf.header.timing {
        Timing::Metrical(ticks_per_quarter) => ticks_per_quarter.as_int(),
        Timing::Timecode(_, _) => return Err(AppError::unsupported_timing_format()),
    };

    let mut notes = Vec::new();
    let mut tempo_changes = Vec::new();
    let mut time_signatures = Vec::new();
    let mut warnings = Vec::new();
    let mut max_tick = 0_u64;
    let mut sequence = 0_u64;

    for (track_index, track) in smf.tracks.iter().enumerate() {
        let mut absolute_tick = 0_u64;
        let mut active_notes: HashMap<NoteKey, VecDeque<ActiveNote>> = HashMap::new();

        for event in track {
            absolute_tick = absolute_tick.saturating_add(u64::from(event.delta.as_int()));
            max_tick = max_tick.max(absolute_tick);

            match &event.kind {
                TrackEventKind::Midi { channel, message } => match message {
                    MidiMessage::NoteOn { key, vel } if vel.as_int() > 0 => {
                        let note_key = NoteKey {
                            channel: channel.as_int(),
                            pitch: key.as_int(),
                        };
                        active_notes
                            .entry(note_key)
                            .or_default()
                            .push_back(ActiveNote {
                                start_tick: absolute_tick,
                                velocity: vel.as_int(),
                                sequence,
                            });
                        sequence = sequence.saturating_add(1);
                    }
                    MidiMessage::NoteOn { key, vel } if vel.as_int() == 0 => {
                        end_note(
                            &mut active_notes,
                            &mut notes,
                            &mut warnings,
                            track_index,
                            channel.as_int(),
                            key.as_int(),
                            absolute_tick,
                        );
                    }
                    MidiMessage::NoteOff { key, .. } => {
                        end_note(
                            &mut active_notes,
                            &mut notes,
                            &mut warnings,
                            track_index,
                            channel.as_int(),
                            key.as_int(),
                            absolute_tick,
                        );
                    }
                    _ => {}
                },
                TrackEventKind::Meta(MetaMessage::Tempo(microseconds_per_quarter)) => {
                    tempo_changes.push(TempoChangeDto {
                        tick: absolute_tick,
                        microseconds_per_quarter: microseconds_per_quarter.as_int(),
                    });
                }
                TrackEventKind::Meta(MetaMessage::TimeSignature(
                    numerator,
                    denominator_power,
                    _clocks_per_click,
                    _thirty_seconds_per_quarter,
                )) => {
                    time_signatures.push(TimeSignatureDto {
                        tick: absolute_tick,
                        numerator: *numerator,
                        denominator: 2_u8.saturating_pow(u32::from(*denominator_power)),
                    });
                }
                _ => {}
            }
        }

        for (note_key, active_queue) in active_notes {
            for active_note in active_queue {
                warnings.push(MidiWarningDto {
                    code: MidiWarningCode::DanglingNoteOn,
                    message: format!(
                        "Closed dangling note-on for track {}, channel {}, pitch {} at track end.",
                        track_index,
                        note_key.channel + 1,
                        note_key.pitch
                    ),
                    track_index: Some(track_index),
                    tick: Some(absolute_tick),
                });
                push_note(
                    notes.as_mut(),
                    warnings.as_mut(),
                    track_index,
                    note_key.channel,
                    note_key.pitch,
                    active_note,
                    absolute_tick,
                );
            }
        }
    }

    notes.sort_by(|left, right| {
        left.start_tick
            .cmp(&right.start_tick)
            .then(left.pitch.cmp(&right.pitch))
            .then(left.end_tick.cmp(&right.end_tick))
            .then(left.source_track_index.cmp(&right.source_track_index))
            .then(left.channel.cmp(&right.channel))
            .then(left.id.cmp(&right.id))
    });

    Ok(MidiProjectDto {
        file_name: path
            .file_name()
            .and_then(|file_name| file_name.to_str())
            .unwrap_or("Untitled MIDI")
            .to_string(),
        format: format_name(smf.header.format).to_string(),
        ppq,
        duration_ticks: max_tick,
        track_count: smf.tracks.len(),
        notes,
        tempo_changes,
        time_signatures,
        warnings,
    })
}

fn end_note(
    active_notes: &mut HashMap<NoteKey, VecDeque<ActiveNote>>,
    notes: &mut Vec<MidiNoteDto>,
    warnings: &mut Vec<MidiWarningDto>,
    track_index: usize,
    channel: u8,
    pitch: u8,
    end_tick: u64,
) {
    let note_key = NoteKey { channel, pitch };
    let Some(active_queue) = active_notes.get_mut(&note_key) else {
        warnings.push(MidiWarningDto {
            code: MidiWarningCode::UnmatchedNoteOff,
            message: format!(
                "Ignored unmatched note-off in track {}, channel {}, pitch {}.",
                track_index,
                channel + 1,
                pitch
            ),
            track_index: Some(track_index),
            tick: Some(end_tick),
        });
        return;
    };

    // FIFO pairing makes overlapping repeated notes end in the same order they began.
    let Some(active_note) = active_queue.pop_front() else {
        warnings.push(MidiWarningDto {
            code: MidiWarningCode::UnmatchedNoteOff,
            message: format!(
                "Ignored unmatched note-off in track {}, channel {}, pitch {}.",
                track_index,
                channel + 1,
                pitch
            ),
            track_index: Some(track_index),
            tick: Some(end_tick),
        });
        return;
    };

    if active_queue.is_empty() {
        active_notes.remove(&note_key);
    }

    push_note(
        notes,
        warnings,
        track_index,
        channel,
        pitch,
        active_note,
        end_tick,
    );
}

fn push_note(
    notes: &mut Vec<MidiNoteDto>,
    warnings: &mut Vec<MidiWarningDto>,
    track_index: usize,
    channel: u8,
    pitch: u8,
    active_note: ActiveNote,
    end_tick: u64,
) {
    if end_tick == active_note.start_tick {
        warnings.push(MidiWarningDto {
            code: MidiWarningCode::ZeroLengthNote,
            message: format!(
                "Imported zero-length note in track {}, channel {}, pitch {}.",
                track_index,
                channel + 1,
                pitch
            ),
            track_index: Some(track_index),
            tick: Some(end_tick),
        });
    }

    let duration_ticks = end_tick.saturating_sub(active_note.start_tick);
    notes.push(MidiNoteDto {
        id: format!(
            "t{track_index}-c{channel}-p{pitch}-s{}-e{end_tick}-n{}",
            active_note.start_tick, active_note.sequence
        ),
        source_track_index: track_index,
        channel,
        pitch,
        velocity: active_note.velocity,
        start_tick: active_note.start_tick,
        end_tick,
        duration_ticks,
    });
}

fn format_name(format: Format) -> &'static str {
    match format {
        Format::SingleTrack => "single-track",
        Format::Parallel => "parallel",
        Format::Sequential => "sequential",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use midly::{
        num::{u15, u24, u28, u4, u7},
        Fps, Header, TrackEvent,
    };
    use std::path::PathBuf;

    fn bytes_for(format: Format, timing: Timing, tracks: Vec<Vec<TrackEvent<'static>>>) -> Vec<u8> {
        let smf = Smf {
            header: Header { format, timing },
            tracks,
        };
        let mut bytes = Vec::new();
        smf.write_std(&mut bytes)
            .expect("test MIDI should serialize");
        bytes
    }

    fn event(delta: u32, kind: TrackEventKind<'static>) -> TrackEvent<'static> {
        TrackEvent {
            delta: u28::new(delta),
            kind,
        }
    }

    fn note_on(delta: u32, channel: u8, pitch: u8, velocity: u8) -> TrackEvent<'static> {
        event(
            delta,
            TrackEventKind::Midi {
                channel: u4::new(channel),
                message: MidiMessage::NoteOn {
                    key: u7::new(pitch),
                    vel: u7::new(velocity),
                },
            },
        )
    }

    fn note_off(delta: u32, channel: u8, pitch: u8) -> TrackEvent<'static> {
        event(
            delta,
            TrackEventKind::Midi {
                channel: u4::new(channel),
                message: MidiMessage::NoteOff {
                    key: u7::new(pitch),
                    vel: u7::new(0),
                },
            },
        )
    }

    fn parse_tracks(tracks: Vec<Vec<TrackEvent<'static>>>) -> MidiProjectDto {
        let bytes = bytes_for(Format::Parallel, Timing::Metrical(u15::new(480)), tracks);
        parse_midi_project(&PathBuf::from("test.mid"), &bytes).expect("test MIDI should parse")
    }

    #[test]
    fn accumulates_absolute_ticks_from_deltas() {
        let project = parse_tracks(vec![vec![note_on(120, 0, 60, 90), note_off(240, 0, 60)]]);

        assert_eq!(project.notes[0].start_tick, 120);
        assert_eq!(project.notes[0].end_tick, 360);
    }

    #[test]
    fn pairs_note_on_and_note_off() {
        let project = parse_tracks(vec![vec![note_on(0, 0, 60, 90), note_off(480, 0, 60)]]);

        assert_eq!(project.notes.len(), 1);
        assert_eq!(project.notes[0].duration_ticks, 480);
    }

    #[test]
    fn treats_note_on_velocity_zero_as_note_off() {
        let project = parse_tracks(vec![vec![note_on(0, 0, 60, 90), note_on(240, 0, 60, 0)]]);

        assert_eq!(project.notes.len(), 1);
        assert_eq!(project.notes[0].end_tick, 240);
    }

    #[test]
    fn keeps_channels_separate() {
        let project = parse_tracks(vec![vec![
            note_on(0, 0, 60, 90),
            note_off(120, 1, 60),
            note_off(120, 0, 60),
        ]]);

        assert_eq!(project.notes.len(), 1);
        assert_eq!(project.warnings[0].code, MidiWarningCode::UnmatchedNoteOff);
    }

    #[test]
    fn pairs_overlapping_same_pitch_fifo() {
        let project = parse_tracks(vec![vec![
            note_on(0, 0, 60, 90),
            note_on(120, 0, 60, 80),
            note_off(120, 0, 60),
            note_off(120, 0, 60),
        ]]);

        assert_eq!(project.notes.len(), 2);
        assert_eq!(project.notes[0].start_tick, 0);
        assert_eq!(project.notes[0].end_tick, 240);
        assert_eq!(project.notes[1].start_tick, 120);
        assert_eq!(project.notes[1].end_tick, 360);
    }

    #[test]
    fn extracts_tempo_events() {
        let project = parse_tracks(vec![vec![event(
            120,
            TrackEventKind::Meta(MetaMessage::Tempo(u24::new(500_000))),
        )]]);

        assert_eq!(project.tempo_changes[0].tick, 120);
        assert_eq!(project.tempo_changes[0].microseconds_per_quarter, 500_000);
    }

    #[test]
    fn extracts_time_signatures() {
        let project = parse_tracks(vec![vec![event(
            0,
            TrackEventKind::Meta(MetaMessage::TimeSignature(3, 3, 24, 8)),
        )]]);

        assert_eq!(project.time_signatures[0].numerator, 3);
        assert_eq!(project.time_signatures[0].denominator, 8);
    }

    #[test]
    fn repairs_dangling_note_on_at_track_end() {
        let project = parse_tracks(vec![vec![
            note_on(120, 0, 64, 90),
            event(360, TrackEventKind::Meta(MetaMessage::EndOfTrack)),
        ]]);

        assert_eq!(project.notes[0].start_tick, 120);
        assert_eq!(project.notes[0].end_tick, 480);
        assert_eq!(project.warnings[0].code, MidiWarningCode::DanglingNoteOn);
    }

    #[test]
    fn warns_on_unmatched_note_off() {
        let project = parse_tracks(vec![vec![note_off(0, 0, 60)]]);

        assert!(project.notes.is_empty());
        assert_eq!(project.warnings[0].code, MidiWarningCode::UnmatchedNoteOff);
    }

    #[test]
    fn rejects_smpte_timing() {
        let bytes = bytes_for(
            Format::SingleTrack,
            Timing::Timecode(Fps::Fps24, 8),
            vec![vec![]],
        );
        let error =
            parse_midi_project(&PathBuf::from("smpte.mid"), &bytes).expect_err("should reject");

        assert_eq!(
            error.code,
            crate::error::AppErrorCode::UnsupportedTimingFormat
        );
    }

    #[test]
    fn sorts_output_deterministically() {
        let project = parse_tracks(vec![vec![
            note_on(240, 0, 67, 90),
            note_on(0, 0, 60, 90),
            note_off(120, 0, 67),
            note_off(0, 0, 60),
        ]]);

        assert_eq!(project.notes[0].pitch, 60);
        assert_eq!(project.notes[1].pitch, 67);
    }

    #[test]
    fn parses_manual_smoke_fixture() {
        let fixture_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("fixtures")
            .join("two-note-smoke.mid");
        let bytes = std::fs::read(&fixture_path).expect("manual fixture should be readable");
        let project =
            parse_midi_project(&fixture_path, &bytes).expect("manual fixture should parse");

        assert_eq!(project.file_name, "two-note-smoke.mid");
        assert_eq!(project.ppq, 480);
        assert_eq!(project.notes.len(), 2);
        assert_eq!(project.duration_ticks, 960);
        assert!(project.warnings.is_empty());
    }
}
