use std::{
    collections::{HashMap, HashSet, VecDeque},
    path::Path,
};

use midly::{Format, MetaMessage, MidiMessage, Smf, Timing, TrackEventKind};

use crate::error::AppError;

use super::model::{
    AssignmentReason, MidiNoteDto, MidiProjectDto, MidiVoiceDto, MidiWarningCode, MidiWarningDto,
    SeparationStrategy, StrategySuggestionDto, TempoChangeDto, TimeSignatureDto,
};
use super::voice_assignment::{
    assign_heuristic_voices, summarize_assigned_voices, summarize_separation_quality,
    PERCUSSION_CHANNEL,
};
use super::{EXPORTED_VOICE_TRACK_MARKER, EXPORTED_VOICE_TRACK_NAME};

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

#[derive(Debug, Clone, Copy)]
struct NoteEventContext<'a> {
    track_index: usize,
    channel: u8,
    pitch: u8,
    voice_id: Option<&'a str>,
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
    let mut exported_voice_track_count = 0_usize;

    for (track_index, track) in smf.tracks.iter().enumerate() {
        let track_voice_id = if is_exported_voice_track(track) {
            exported_voice_track_count += 1;
            Some(format!("voice-{exported_voice_track_count}"))
        } else {
            None
        };
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
                            NoteEventContext {
                                track_index,
                                channel: channel.as_int(),
                                pitch: key.as_int(),
                                voice_id: track_voice_id.as_deref(),
                            },
                            absolute_tick,
                        );
                    }
                    MidiMessage::NoteOff { key, .. } => {
                        end_note(
                            &mut active_notes,
                            &mut notes,
                            &mut warnings,
                            NoteEventContext {
                                track_index,
                                channel: channel.as_int(),
                                pitch: key.as_int(),
                                voice_id: track_voice_id.as_deref(),
                            },
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
                    &mut notes,
                    &mut warnings,
                    NoteEventContext {
                        track_index,
                        channel: note_key.channel,
                        pitch: note_key.pitch,
                        voice_id: track_voice_id.as_deref(),
                    },
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
    let mut voices = if !notes.is_empty() && notes.iter().all(|note| !note.voice_id.is_empty()) {
        summarize_assigned_voices(&notes)
    } else {
        assign_heuristic_voices(&mut notes)
    };
    let track_names: Vec<Option<String>> = smf
        .tracks
        .iter()
        .map(|track| extract_track_name(track))
        .collect();
    apply_track_name_labels(
        &mut voices,
        &notes,
        &track_names,
        exported_voice_track_count > 0,
    );
    let separation_summary = summarize_separation_quality(&notes);
    let strategy_suggestion = suggest_strategy(&notes);

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
        voices,
        notes,
        tempo_changes,
        time_signatures,
        warnings,
        separation_summary,
        strategy_suggestion,
    })
}

/// Identifies MIDI exported by this app without assigning it again. This is
/// intentionally separate from parsing the project DTO so the command layer
/// can mint the corresponding provenance while keeping parser callers simple.
pub fn has_exported_voice_tracks(bytes: &[u8]) -> bool {
    Smf::parse(bytes)
        .map(|smf| {
            smf.tracks
                .iter()
                .any(|track| is_exported_voice_track(track))
        })
        .unwrap_or(false)
}

/// The first named `TrackName` in a track, decoded leniently and trimmed;
/// `None` for unnamed tracks and for the legacy fixed export sentinel
/// (which was a detection marker, not a real name).
fn extract_track_name(track: &[midly::TrackEvent<'_>]) -> Option<String> {
    track.iter().find_map(|event| match &event.kind {
        TrackEventKind::Meta(MetaMessage::TrackName(name))
            if *name != EXPORTED_VOICE_TRACK_NAME =>
        {
            let decoded = String::from_utf8_lossy(name).trim().to_string();
            (!decoded.is_empty()).then_some(decoded)
        }
        _ => None,
    })
}

/// Labels each voice with the name of the track the majority of its notes
/// came from, when that track has one — "Lead" beats "Voice 3" for
/// orientation. Duplicate names get a numeric suffix so two tracks named
/// "Square" yield "Square" and "Square 2". Voices whose majority track is
/// unnamed keep their default label.
///
/// Skipped entirely when all notes live in a single track (unless it's an
/// app-exported voice track, where the name genuinely is the voice's
/// label): a lone track's name identifies the song, not an instrument, and
/// stamping "Song Title 3" on every voice is noise rather than
/// orientation.
fn apply_track_name_labels(
    voices: &mut [MidiVoiceDto],
    notes: &[MidiNoteDto],
    track_names: &[Option<String>],
    has_exported_voice_tracks: bool,
) {
    let note_bearing_tracks: HashSet<usize> =
        notes.iter().map(|note| note.source_track_index).collect();
    if note_bearing_tracks.len() < 2 && !has_exported_voice_tracks {
        return;
    }

    let mut times_used: HashMap<String, usize> = HashMap::new();
    for voice in voices.iter_mut() {
        let mut counts: HashMap<usize, usize> = HashMap::new();
        for note in notes.iter().filter(|note| note.voice_id == voice.id) {
            *counts.entry(note.source_track_index).or_default() += 1;
        }
        // Majority track; ties break toward the lowest track index so the
        // outcome never depends on hash iteration order.
        let majority_track = counts
            .into_iter()
            .max_by(|left, right| left.1.cmp(&right.1).then(right.0.cmp(&left.0)))
            .map(|(track_index, _)| track_index);
        let Some(name) = majority_track
            .and_then(|track_index| track_names.get(track_index))
            .and_then(|name| name.as_deref())
        else {
            continue;
        };

        let seen = times_used.entry(name.to_string()).or_insert(0);
        *seen += 1;
        voice.label = if *seen == 1 {
            name.to_string()
        } else {
            format!("{name} {seen}")
        };
    }
}

/// Recommends a `SeparationStrategy` from the melodic (non-percussion)
/// channel distribution: several channels each carrying a real share of
/// the notes means channel is a trustworthy separation signal; one
/// dominant channel means it isn't, and pitch register has to do the work.
fn suggest_strategy(notes: &[MidiNoteDto]) -> StrategySuggestionDto {
    let melodic_count = notes
        .iter()
        .filter(|note| note.channel != PERCUSSION_CHANNEL)
        .count();
    let percussion_count = notes.len() - melodic_count;
    let percussion_suffix = if percussion_count > 0 {
        " Channel-10 drums are routed to their own Percussion voice."
    } else {
        ""
    };

    if melodic_count == 0 {
        return StrategySuggestionDto {
            strategy: SeparationStrategy::Balanced,
            reason: format!("No melodic notes to analyze.{percussion_suffix}"),
        };
    }

    let mut channel_counts: HashMap<u8, usize> = HashMap::new();
    for note in notes
        .iter()
        .filter(|note| note.channel != PERCUSSION_CHANNEL)
    {
        *channel_counts.entry(note.channel).or_default() += 1;
    }
    // A channel is significant if it holds at least 5% of melodic notes.
    let significant_channels = channel_counts
        .values()
        .filter(|&&count| count * 20 >= melodic_count)
        .count();
    let max_share_percent = channel_counts
        .values()
        .map(|&count| count * 100 / melodic_count)
        .max()
        .unwrap_or(0);

    if significant_channels >= 2 && max_share_percent <= 60 {
        StrategySuggestionDto {
            strategy: SeparationStrategy::StrictChannel,
            reason: format!(
                "{significant_channels} instrument channels detected — channel is a reliable separation signal.{percussion_suffix}"
            ),
        }
    } else if significant_channels >= 2 {
        StrategySuggestionDto {
            strategy: SeparationStrategy::RegisterPriority,
            reason: format!(
                "One channel holds {max_share_percent}% of the notes — channel alone can't separate them, so pitch register leads.{percussion_suffix}"
            ),
        }
    } else {
        StrategySuggestionDto {
            strategy: SeparationStrategy::RegisterPriority,
            reason: format!(
                "Nearly all notes share one channel — separating by pitch register.{percussion_suffix}"
            ),
        }
    }
}

fn is_exported_voice_track(track: &[midly::TrackEvent<'_>]) -> bool {
    track.iter().any(|event| {
        // Current exports carry a `Text` marker so the track name is free
        // to hold the real voice label; the fixed `TrackName` sentinel is
        // how exports before that change marked themselves.
        matches!(
            &event.kind,
            TrackEventKind::Meta(MetaMessage::Text(text)) if *text == EXPORTED_VOICE_TRACK_MARKER
        ) || matches!(
            &event.kind,
            TrackEventKind::Meta(MetaMessage::TrackName(name)) if *name == EXPORTED_VOICE_TRACK_NAME
        )
    })
}

fn end_note(
    active_notes: &mut HashMap<NoteKey, VecDeque<ActiveNote>>,
    notes: &mut Vec<MidiNoteDto>,
    warnings: &mut Vec<MidiWarningDto>,
    context: NoteEventContext<'_>,
    end_tick: u64,
) {
    let note_key = NoteKey {
        channel: context.channel,
        pitch: context.pitch,
    };
    let Some(active_queue) = active_notes.get_mut(&note_key) else {
        warnings.push(MidiWarningDto {
            code: MidiWarningCode::UnmatchedNoteOff,
            message: format!(
                "Ignored unmatched note-off in track {}, channel {}, pitch {}.",
                context.track_index,
                context.channel + 1,
                context.pitch
            ),
            track_index: Some(context.track_index),
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
                context.track_index,
                context.channel + 1,
                context.pitch
            ),
            track_index: Some(context.track_index),
            tick: Some(end_tick),
        });
        return;
    };

    if active_queue.is_empty() {
        active_notes.remove(&note_key);
    }

    push_note(notes, warnings, context, active_note, end_tick);
}

fn push_note(
    notes: &mut Vec<MidiNoteDto>,
    warnings: &mut Vec<MidiWarningDto>,
    context: NoteEventContext<'_>,
    active_note: ActiveNote,
    end_tick: u64,
) {
    if end_tick == active_note.start_tick {
        warnings.push(MidiWarningDto {
            code: MidiWarningCode::ZeroLengthNote,
            message: format!(
                "Imported zero-length note in track {}, channel {}, pitch {}.",
                context.track_index,
                context.channel + 1,
                context.pitch
            ),
            track_index: Some(context.track_index),
            tick: Some(end_tick),
        });
    }

    let duration_ticks = end_tick.saturating_sub(active_note.start_tick);
    let (assignment_confidence, assignment_reason) = if context.voice_id.is_some() {
        (1.0, AssignmentReason::Imported)
    } else {
        (0.0, AssignmentReason::ClosestPitch)
    };
    notes.push(MidiNoteDto {
        id: format!(
            "t{track_index}-c{channel}-p{pitch}-s{}-e{end_tick}-n{}",
            active_note.start_tick,
            active_note.sequence,
            track_index = context.track_index,
            channel = context.channel,
            pitch = context.pitch
        ),
        voice_id: context.voice_id.unwrap_or_default().to_string(),
        source_track_index: context.track_index,
        channel: context.channel,
        pitch: context.pitch,
        velocity: active_note.velocity,
        start_tick: active_note.start_tick,
        end_tick,
        duration_ticks,
        assignment_confidence,
        assignment_reason,
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
        assert_eq!(project.voices.len(), 1);
        assert_eq!(project.duration_ticks, 960);
        assert!(project.warnings.is_empty());
    }

    fn track_name(name: &'static [u8]) -> TrackEvent<'static> {
        event(0, TrackEventKind::Meta(MetaMessage::TrackName(name)))
    }

    #[test]
    fn labels_voices_from_their_majority_tracks_name() {
        let project = parse_tracks(vec![
            vec![
                track_name(b"Lead"),
                note_on(0, 0, 72, 90),
                note_off(240, 0, 72),
            ],
            vec![
                track_name(b"Bass"),
                note_on(0, 0, 40, 90),
                note_off(240, 0, 40),
            ],
        ]);

        assert_eq!(project.voices.len(), 2);
        // Notes sort pitch-ascending at the same tick, so the bass note
        // opens voice-1.
        assert_eq!(project.voices[0].label, "Bass");
        assert_eq!(project.voices[1].label, "Lead");
    }

    #[test]
    fn duplicate_track_names_get_numeric_suffixes() {
        let project = parse_tracks(vec![
            vec![
                track_name(b"Square"),
                note_on(0, 0, 72, 90),
                note_off(240, 0, 72),
            ],
            vec![
                track_name(b"Square"),
                note_on(0, 0, 40, 90),
                note_off(240, 0, 40),
            ],
        ]);

        let labels: Vec<&str> = project
            .voices
            .iter()
            .map(|voice| voice.label.as_str())
            .collect();
        assert!(labels.contains(&"Square"));
        assert!(labels.contains(&"Square 2"));
    }

    #[test]
    fn unnamed_tracks_keep_default_voice_labels() {
        let project = parse_tracks(vec![vec![note_on(0, 0, 60, 90), note_off(240, 0, 60)]]);

        assert_eq!(project.voices[0].label, "Voice 1");
    }

    #[test]
    fn a_single_note_bearing_tracks_name_is_the_songs_name_not_a_voice_label() {
        // One track named "Song Title" holding two overlapping notes: the
        // heuristic makes two voices, and neither should be stamped with
        // the song's name.
        let project = parse_tracks(vec![vec![
            track_name(b"Song Title"),
            note_on(0, 0, 60, 90),
            note_on(0, 0, 72, 90),
            note_off(240, 0, 60),
            note_off(0, 0, 72),
        ]]);

        assert_eq!(project.voices.len(), 2);
        assert_eq!(project.voices[0].label, "Voice 1");
        assert_eq!(project.voices[1].label, "Voice 2");
    }

    #[test]
    fn legacy_export_sentinel_still_marks_a_track_as_exported_and_never_becomes_a_label() {
        let project = parse_tracks(vec![vec![
            event(
                0,
                TrackEventKind::Meta(MetaMessage::TrackName(EXPORTED_VOICE_TRACK_NAME)),
            ),
            note_on(0, 0, 60, 90),
            note_off(240, 0, 60),
        ]]);

        assert_eq!(project.notes[0].voice_id, "voice-1");
        assert_eq!(
            project.notes[0].assignment_reason,
            AssignmentReason::Imported
        );
        assert_eq!(project.voices[0].label, "Voice 1");
    }

    #[test]
    fn suggests_strict_channel_when_channels_share_the_notes() {
        let project = parse_tracks(vec![vec![
            note_on(0, 0, 60, 90),
            note_off(240, 0, 60),
            note_on(0, 1, 72, 90),
            note_off(240, 1, 72),
        ]]);

        assert_eq!(
            project.strategy_suggestion.strategy,
            SeparationStrategy::StrictChannel
        );
    }

    #[test]
    fn suggests_register_priority_for_a_single_channel_file() {
        let project = parse_tracks(vec![vec![note_on(0, 0, 60, 90), note_off(240, 0, 60)]]);

        assert_eq!(
            project.strategy_suggestion.strategy,
            SeparationStrategy::RegisterPriority
        );
    }

    #[test]
    fn suggests_register_priority_when_one_channel_dominates() {
        let mut events = Vec::new();
        // Eight sequential notes on channel 0, one on channel 1: channel 1
        // is significant (>5%) but channel 0's 89% share means channel
        // continuity can't be trusted to separate the file.
        for step in 0..8 {
            events.push(note_on(if step == 0 { 0 } else { 60 }, 0, 60, 90));
            events.push(note_off(60, 0, 60));
        }
        events.push(note_on(60, 1, 72, 90));
        events.push(note_off(60, 1, 72));
        let project = parse_tracks(vec![events]);

        assert_eq!(
            project.strategy_suggestion.strategy,
            SeparationStrategy::RegisterPriority
        );
        assert!(project.strategy_suggestion.reason.contains("%"));
    }

    #[test]
    fn routes_channel_ten_notes_to_the_percussion_voice_on_import() {
        let project = parse_tracks(vec![vec![
            note_on(0, 9, 36, 90),
            note_off(120, 9, 36),
            note_on(0, 0, 60, 90),
            note_off(240, 0, 60),
        ]]);

        let drum_note = project
            .notes
            .iter()
            .find(|note| note.channel == 9)
            .expect("drum note should import");
        assert_eq!(drum_note.voice_id, "percussion");
        assert_eq!(drum_note.assignment_reason, AssignmentReason::Percussion);
        assert!(project.voices.iter().any(|voice| {
            voice.id == "percussion"
                && voice.label == "Percussion"
                && voice.role == crate::midi::model::VoiceRoleDto::Percussion
        }));
        assert!(project.strategy_suggestion.reason.contains("Percussion"));
    }

    #[test]
    fn assigns_voice_ids_deterministically_after_sorting() {
        let first_project = parse_tracks(vec![vec![
            note_on(0, 0, 60, 90),
            note_on(0, 0, 64, 90),
            note_off(240, 0, 60),
            note_off(0, 0, 64),
            note_on(0, 0, 65, 90),
            note_off(240, 0, 65),
        ]]);
        let second_project = parse_tracks(vec![vec![
            note_on(0, 0, 60, 90),
            note_on(0, 0, 64, 90),
            note_off(240, 0, 60),
            note_off(0, 0, 64),
            note_on(0, 0, 65, 90),
            note_off(240, 0, 65),
        ]]);

        assert_eq!(first_project.voices.len(), 2);
        assert_eq!(first_project.notes[0].voice_id, "voice-1");
        assert_eq!(first_project.notes[1].voice_id, "voice-2");
        assert_eq!(first_project.notes[2].voice_id, "voice-2");
        assert_eq!(first_project, second_project);
    }
}

#[cfg(test)]
mod robustness_tests {
    use super::parse_midi_project;
    use std::{
        panic::{catch_unwind, AssertUnwindSafe},
        path::Path,
    };

    #[test]
    fn arbitrary_untrusted_bytes_never_panic_the_parser() {
        // This deterministic fuzz-like corpus covers many truncated and malformed
        // inputs without making the test suite depend on a separate fuzz runner.
        let mut state = 0x5eed_cafe_u64;
        for length in 0..=512 {
            let mut bytes = Vec::with_capacity(length);
            for _ in 0..length {
                state = state.wrapping_mul(6364136223846793005).wrapping_add(1);
                bytes.push((state >> 24) as u8);
            }
            let result = catch_unwind(AssertUnwindSafe(|| {
                parse_midi_project(Path::new("untrusted.mid"), &bytes)
            }));
            assert!(
                result.is_ok(),
                "parser panicked for malformed input of length {length}"
            );
        }
    }
}
