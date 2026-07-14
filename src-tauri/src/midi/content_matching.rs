use super::model::MidiNoteDto;

/// Exact, reduced position in quarter-note units. MIDI ticks are normalized
/// before correspondence so the same musical position compares equally across
/// files with different PPQs, without introducing floating-point error.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct RationalQuarter {
    pub numerator: u64,
    pub denominator: u16,
}

impl RationalQuarter {
    fn from_ticks(tick: u64, ppq: u16) -> Result<Self, ContentMatchError> {
        if ppq == 0 {
            return Err(ContentMatchError::InvalidPpq);
        }

        let divisor = gcd(tick, u64::from(ppq));
        Ok(Self {
            numerator: tick / divisor,
            denominator: (u64::from(ppq) / divisor) as u16,
        })
    }
}

/// The supported semantic content of a MIDI note. Local IDs, assigned voice,
/// source track, confidence, and reason deliberately do not participate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct CanonicalNoteAtom {
    pub pitch: u8,
    pub channel: u8,
    pub velocity: u8,
    pub start_quarters: RationalQuarter,
    pub end_quarters: RationalQuarter,
}

/// A canonical note keeps its local address only for deterministic output
/// order. `note_id` is never part of the content atom or a cross-document
/// identity claim.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CanonicalNote {
    pub note_id: String,
    pub atom: CanonicalNoteAtom,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ContentMatchError {
    InvalidPpq,
    EndBeforeStart {
        note_id: String,
        start_tick: u64,
        end_tick: u64,
    },
}

/// Converts a note into the exact content atom shared by strict and tolerant
/// correspondence policies. Zero-length notes are accepted because the parser
/// already represents that supported edge case.
pub(crate) fn canonicalize_note(
    note: &MidiNoteDto,
    ppq: u16,
) -> Result<CanonicalNoteAtom, ContentMatchError> {
    if note.end_tick < note.start_tick {
        return Err(ContentMatchError::EndBeforeStart {
            note_id: note.id.clone(),
            start_tick: note.start_tick,
            end_tick: note.end_tick,
        });
    }

    Ok(CanonicalNoteAtom {
        pitch: note.pitch,
        channel: note.channel,
        velocity: note.velocity,
        start_quarters: RationalQuarter::from_ticks(note.start_tick, ppq)?,
        end_quarters: RationalQuarter::from_ticks(note.end_tick, ppq)?,
    })
}

/// Canonicalizes and deterministically orders a note collection. Future
/// matching policies consume this seam rather than relying on parser/input
/// order; local ids break only output-order ties between equal atoms.
pub(crate) fn canonicalize_notes(
    notes: &[MidiNoteDto],
    ppq: u16,
) -> Result<Vec<CanonicalNote>, ContentMatchError> {
    let mut canonical = notes
        .iter()
        .map(|note| {
            Ok(CanonicalNote {
                note_id: note.id.clone(),
                atom: canonicalize_note(note, ppq)?,
            })
        })
        .collect::<Result<Vec<_>, ContentMatchError>>()?;

    canonical.sort_by(|left, right| {
        left.atom
            .cmp(&right.atom)
            .then_with(|| left.note_id.cmp(&right.note_id))
    });
    Ok(canonical)
}

fn gcd(mut left: u64, mut right: u64) -> u64 {
    while right != 0 {
        let remainder = left % right;
        left = right;
        right = remainder;
    }
    left
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::midi::model::AssignmentReason;

    fn note(id: &str, start_tick: u64, end_tick: u64) -> MidiNoteDto {
        MidiNoteDto {
            id: id.to_string(),
            voice_id: "voice-local".to_string(),
            source_track_index: 7,
            channel: 2,
            pitch: 60,
            velocity: 100,
            start_tick,
            end_tick,
            duration_ticks: end_tick.saturating_sub(start_tick),
            assignment_confidence: 0.4,
            assignment_reason: AssignmentReason::Imported,
        }
    }

    #[test]
    fn normalizes_equivalent_positions_across_ppqs() {
        let at_96 = note("a", 24, 72);
        let at_480 = note("b", 120, 360);
        let at_960 = note("c", 240, 720);

        let expected = canonicalize_note(&at_96, 96).unwrap();
        assert_eq!(canonicalize_note(&at_480, 480).unwrap(), expected);
        assert_eq!(canonicalize_note(&at_960, 960).unwrap(), expected);
        assert_eq!(
            expected.start_quarters,
            RationalQuarter {
                numerator: 1,
                denominator: 4
            }
        );
        assert_eq!(
            expected.end_quarters,
            RationalQuarter {
                numerator: 3,
                denominator: 4
            }
        );
    }

    #[test]
    fn reduces_zero_and_nontrivial_fractions() {
        let zero = note("zero", 0, 0);
        let reduced = note("reduced", 180, 420);

        assert_eq!(
            canonicalize_note(&zero, 480).unwrap().start_quarters,
            RationalQuarter {
                numerator: 0,
                denominator: 1
            }
        );
        assert_eq!(
            canonicalize_note(&reduced, 480).unwrap().start_quarters,
            RationalQuarter {
                numerator: 3,
                denominator: 8
            }
        );
        assert_eq!(
            canonicalize_note(&reduced, 480).unwrap().end_quarters,
            RationalQuarter {
                numerator: 7,
                denominator: 8
            }
        );
    }

    #[test]
    fn rejects_zero_ppq() {
        assert_eq!(
            canonicalize_note(&note("bad", 0, 1), 0),
            Err(ContentMatchError::InvalidPpq)
        );
    }

    #[test]
    fn rejects_end_before_start_with_the_local_address() {
        assert_eq!(
            canonicalize_note(&note("bad", 9, 8), 480),
            Err(ContentMatchError::EndBeforeStart {
                note_id: "bad".to_string(),
                start_tick: 9,
                end_tick: 8,
            })
        );
    }

    #[test]
    fn ignores_local_and_assignment_metadata_in_the_atom() {
        let first = note("first", 10, 20);
        let mut second = note("second", 10, 20);
        second.voice_id = "voice-other".to_string();
        second.source_track_index = 99;
        second.assignment_confidence = 1.0;
        second.assignment_reason = AssignmentReason::UserLocked;

        assert_eq!(
            canonicalize_note(&first, 480).unwrap(),
            canonicalize_note(&second, 480).unwrap()
        );
    }

    #[test]
    fn orders_canonical_notes_independently_of_input_order() {
        let mut earlier = note("z-tie", 10, 20);
        earlier.pitch = 59;
        let later = note("a-tie", 10, 20);
        let same_atom_lower_id = note("a-same", 10, 20);

        let forward = canonicalize_notes(
            &[later.clone(), earlier.clone(), same_atom_lower_id.clone()],
            480,
        )
        .unwrap();
        let reversed = canonicalize_notes(&[same_atom_lower_id, earlier, later], 480).unwrap();

        assert_eq!(forward, reversed);
        assert_eq!(
            forward
                .iter()
                .map(|entry| entry.note_id.as_str())
                .collect::<Vec<_>>(),
            vec!["z-tie", "a-same", "a-tie"]
        );
    }
}
