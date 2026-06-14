use super::model::{MidiNoteDto, MidiVoiceDto};

#[derive(Debug, Clone)]
struct VoiceState {
    id: String,
    last_end_tick: u64,
    last_pitch: u8,
    note_count: usize,
    lowest_pitch: u8,
    highest_pitch: u8,
}

pub fn assign_heuristic_voices(notes: &mut [MidiNoteDto]) -> Vec<MidiVoiceDto> {
    let mut voices: Vec<VoiceState> = Vec::new();

    for note in notes {
        let voice_index = best_voice_index(&voices, note).unwrap_or_else(|| {
            let next_index = voices.len();
            voices.push(VoiceState {
                id: format!("voice-{}", next_index + 1),
                last_end_tick: 0,
                last_pitch: note.pitch,
                note_count: 0,
                lowest_pitch: note.pitch,
                highest_pitch: note.pitch,
            });
            next_index
        });

        let voice = &mut voices[voice_index];
        note.voice_id.clone_from(&voice.id);
        voice.last_end_tick = note.end_tick;
        voice.last_pitch = note.pitch;
        voice.note_count += 1;
        voice.lowest_pitch = voice.lowest_pitch.min(note.pitch);
        voice.highest_pitch = voice.highest_pitch.max(note.pitch);
    }

    voices
        .into_iter()
        .enumerate()
        .map(|(index, voice)| MidiVoiceDto {
            id: voice.id,
            label: format!("Voice {}", index + 1),
            note_count: voice.note_count,
            lowest_pitch: voice.lowest_pitch,
            highest_pitch: voice.highest_pitch,
        })
        .collect()
}

fn best_voice_index(voices: &[VoiceState], note: &MidiNoteDto) -> Option<usize> {
    voices
        .iter()
        .enumerate()
        .filter(|(_, voice)| voice.last_end_tick <= note.start_tick)
        .min_by_key(|(index, voice)| {
            (
                voice.last_pitch.abs_diff(note.pitch),
                voice.last_end_tick,
                *index,
            )
        })
        .map(|(index, _)| index)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(id: &str, pitch: u8, start_tick: u64, end_tick: u64) -> MidiNoteDto {
        MidiNoteDto {
            id: id.to_string(),
            voice_id: String::new(),
            source_track_index: 0,
            channel: 0,
            pitch,
            velocity: 100,
            start_tick,
            end_tick,
            duration_ticks: end_tick - start_tick,
        }
    }

    #[test]
    fn reuses_a_compatible_voice() {
        let mut notes = vec![note("a", 60, 0, 120), note("b", 62, 120, 240)];

        let voices = assign_heuristic_voices(&mut notes);

        assert_eq!(voices.len(), 1);
        assert_eq!(notes[0].voice_id, "voice-1");
        assert_eq!(notes[1].voice_id, "voice-1");
    }

    #[test]
    fn separates_overlapping_notes() {
        let mut notes = vec![note("a", 60, 0, 240), note("b", 64, 120, 360)];

        let voices = assign_heuristic_voices(&mut notes);

        assert_eq!(voices.len(), 2);
        assert_eq!(notes[0].voice_id, "voice-1");
        assert_eq!(notes[1].voice_id, "voice-2");
    }

    #[test]
    fn chooses_closest_prior_pitch_for_reuse() {
        let mut notes = vec![
            note("low", 48, 0, 120),
            note("high", 72, 0, 120),
            note("next-high", 71, 120, 240),
        ];

        assign_heuristic_voices(&mut notes);

        assert_eq!(notes[2].voice_id, "voice-2");
    }

    #[test]
    fn assigns_repeatably() {
        let original = vec![
            note("a", 60, 0, 240),
            note("b", 64, 120, 360),
            note("c", 65, 360, 480),
        ];
        let mut first = original.clone();
        let mut second = original;

        assign_heuristic_voices(&mut first);
        assign_heuristic_voices(&mut second);

        let first_assignments: Vec<_> = first.iter().map(|note| note.voice_id.clone()).collect();
        let second_assignments: Vec<_> = second.iter().map(|note| note.voice_id.clone()).collect();
        assert_eq!(first_assignments, second_assignments);
    }
}
