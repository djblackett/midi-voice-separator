use super::model::MidiNoteDto;
use std::collections::HashSet;

/// Bump when a correspondence-policy change can alter match results.
pub(crate) const NOTE_CORRESPONDENCE_MATCHER_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum NoteMatchPolicy {
    SameDocumentV1,
    StrictRoundTripV1,
    CrossImportV1,
}

/// Side-qualified local address returned by correspondence. The address lets a
/// caller find a note in its own document; it is not global content identity.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) struct MatchNoteRef {
    pub document_id: String,
    pub note_id: String,
}

/// Lightweight matcher input. It borrows immutable parsed/project notes; the
/// matcher never owns or mutates an editor document.
pub(crate) struct MatchDocument<'a> {
    pub document_id: &'a str,
    pub ppq: u16,
    pub notes: &'a [MidiNoteDto],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct MatchedNotePair {
    pub left: MatchNoteRef,
    pub right: MatchNoteRef,
}

/// Local-ID correspondence for two views of the same editor document. This is
/// deliberately separate from content matching: a caller must opt into a
/// semantic policy before local document identity can no longer be trusted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SameDocumentMatchResult {
    pub matcher_version: u32,
    pub policy: NoteMatchPolicy,
    pub comparable: bool,
    pub incomparable_reason: Option<IncomparableReason>,
    pub local_id_pairs: Vec<MatchedNotePair>,
    pub unmatched_left: Vec<MatchNoteRef>,
    pub unmatched_right: Vec<MatchNoteRef>,
}

/// A duplicate exact-content bucket. `matched_multiplicity` contributes to
/// strict semantic verification, but individual local references remain
/// ambiguous: their occurrence order must never create a fake pairing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AmbiguousExactNoteGroup {
    pub atom: CanonicalNoteAtom,
    pub left: Vec<MatchNoteRef>,
    pub right: Vec<MatchNoteRef>,
    pub matched_multiplicity: usize,
    pub unmatched_left_multiplicity: usize,
    pub unmatched_right_multiplicity: usize,
}

/// Strict correspondence output. Exact duplicate multisets count toward the
/// supported semantic model while preserving the ambiguity needed by a future
/// cross-import UI.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StrictNoteMatchResult {
    pub matcher_version: u32,
    pub policy: NoteMatchPolicy,
    pub exact_match_multiplicity: usize,
    pub exact_pairs: Vec<MatchedNotePair>,
    pub ambiguous_exact_groups: Vec<AmbiguousExactNoteGroup>,
    pub unmatched_left: Vec<MatchNoteRef>,
    pub unmatched_right: Vec<MatchNoteRef>,
}

/// Non-negative rational-quarter distance retained as a score component; no
/// floating-point value can make a boundary decision drift across PPQs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct RationalQuarterDistance {
    pub numerator: u128,
    pub denominator: u128,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FuzzyNoteCandidate {
    pub left: MatchNoteRef,
    pub right: MatchNoteRef,
    pub onset_distance: RationalQuarterDistance,
    pub duration_distance: RationalQuarterDistance,
    pub same_channel: bool,
    pub velocity_difference: u8,
}

/// Exact-first candidate discovery for the future cross-import policy. B1
/// intentionally discovers sparse scored edges only; B2 decides which unique
/// candidates are safe to materialize as fuzzy pairs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CrossImportCandidateResult {
    pub matcher_version: u32,
    pub policy: NoteMatchPolicy,
    pub exact: StrictNoteMatchResult,
    pub fuzzy_candidates: Vec<FuzzyNoteCandidate>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FuzzyMatchedNotePair {
    pub left: MatchNoteRef,
    pub right: MatchNoteRef,
    pub onset_distance: RationalQuarterDistance,
    pub duration_distance: RationalQuarterDistance,
    pub same_channel: bool,
    pub velocity_difference: u8,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct MatchCoverage {
    pub total: usize,
    pub exact: usize,
    pub fuzzy: usize,
    pub ambiguous: usize,
    pub unmatched: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum IncomparableReason {
    DifferentDocumentIds,
    InsufficientCoverage,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CrossImportMatchResult {
    pub matcher_version: u32,
    pub policy: NoteMatchPolicy,
    pub comparable: bool,
    pub incomparable_reason: Option<IncomparableReason>,
    pub left_coverage: MatchCoverage,
    pub right_coverage: MatchCoverage,
    pub exact_pairs: Vec<MatchedNotePair>,
    pub fuzzy_pairs: Vec<FuzzyMatchedNotePair>,
    pub ambiguous_fuzzy_candidates: Vec<FuzzyNoteCandidate>,
    pub unmatched_left: Vec<MatchNoteRef>,
    pub unmatched_right: Vec<MatchNoteRef>,
}

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

/// Pairs shared local note IDs only after proving both inputs represent the
/// same document. It does not inspect MIDI content, PPQ, or note ordering;
/// different documents remain incomparable rather than falling through to a
/// content-derived policy.
pub(crate) fn match_same_document_notes(
    left: MatchDocument<'_>,
    right: MatchDocument<'_>,
) -> SameDocumentMatchResult {
    let left_refs = local_note_refs(&left);
    let right_refs = local_note_refs(&right);
    if left.document_id != right.document_id {
        return SameDocumentMatchResult {
            matcher_version: NOTE_CORRESPONDENCE_MATCHER_VERSION,
            policy: NoteMatchPolicy::SameDocumentV1,
            comparable: false,
            incomparable_reason: Some(IncomparableReason::DifferentDocumentIds),
            local_id_pairs: Vec::new(),
            unmatched_left: left_refs,
            unmatched_right: right_refs,
        };
    }

    let mut local_id_pairs = Vec::new();
    let mut unmatched_left = Vec::new();
    let mut unmatched_right = Vec::new();
    let mut left_index = 0;
    let mut right_index = 0;
    while left_index < left_refs.len() && right_index < right_refs.len() {
        match left_refs[left_index]
            .note_id
            .cmp(&right_refs[right_index].note_id)
        {
            std::cmp::Ordering::Less => {
                unmatched_left.push(left_refs[left_index].clone());
                left_index += 1;
            }
            std::cmp::Ordering::Greater => {
                unmatched_right.push(right_refs[right_index].clone());
                right_index += 1;
            }
            std::cmp::Ordering::Equal => {
                local_id_pairs.push(MatchedNotePair {
                    left: left_refs[left_index].clone(),
                    right: right_refs[right_index].clone(),
                });
                left_index += 1;
                right_index += 1;
            }
        }
    }
    unmatched_left.extend(left_refs.into_iter().skip(left_index));
    unmatched_right.extend(right_refs.into_iter().skip(right_index));

    SameDocumentMatchResult {
        matcher_version: NOTE_CORRESPONDENCE_MATCHER_VERSION,
        policy: NoteMatchPolicy::SameDocumentV1,
        comparable: true,
        incomparable_reason: None,
        local_id_pairs,
        unmatched_left,
        unmatched_right,
    }
}

/// Matches only exact supported note content after PPQ normalization. It has
/// no tolerance path: any different canonical atom is reported unmatched.
pub(crate) fn match_strict_notes(
    left: MatchDocument<'_>,
    right: MatchDocument<'_>,
) -> Result<StrictNoteMatchResult, ContentMatchError> {
    let left_notes = canonicalize_notes(left.notes, left.ppq)?;
    let right_notes = canonicalize_notes(right.notes, right.ppq)?;
    let mut exact_pairs = Vec::new();
    let mut exact_match_multiplicity = 0;
    let mut ambiguous_exact_groups = Vec::new();
    let mut unmatched_left = Vec::new();
    let mut unmatched_right = Vec::new();
    let mut left_index = 0;
    let mut right_index = 0;

    while left_index < left_notes.len() && right_index < right_notes.len() {
        let left_note = &left_notes[left_index];
        let right_note = &right_notes[right_index];
        match left_note.atom.cmp(&right_note.atom) {
            std::cmp::Ordering::Less => {
                let next = atom_group_end(&left_notes, left_index);
                unmatched_left.extend(
                    left_notes[left_index..next]
                        .iter()
                        .map(|note| note_ref(left.document_id, note)),
                );
                left_index = next;
            }
            std::cmp::Ordering::Greater => {
                let next = atom_group_end(&right_notes, right_index);
                unmatched_right.extend(
                    right_notes[right_index..next]
                        .iter()
                        .map(|note| note_ref(right.document_id, note)),
                );
                right_index = next;
            }
            std::cmp::Ordering::Equal => {
                let left_end = atom_group_end(&left_notes, left_index);
                let right_end = atom_group_end(&right_notes, right_index);
                let left_group = &left_notes[left_index..left_end];
                let right_group = &right_notes[right_index..right_end];

                if left_group.len() == 1 && right_group.len() == 1 {
                    exact_pairs.push(MatchedNotePair {
                        left: note_ref(left.document_id, &left_group[0]),
                        right: note_ref(right.document_id, &right_group[0]),
                    });
                    exact_match_multiplicity += 1;
                } else {
                    let matched_multiplicity = left_group.len().min(right_group.len());
                    exact_match_multiplicity += matched_multiplicity;
                    ambiguous_exact_groups.push(AmbiguousExactNoteGroup {
                        atom: left_group[0].atom,
                        left: left_group
                            .iter()
                            .map(|note| note_ref(left.document_id, note))
                            .collect(),
                        right: right_group
                            .iter()
                            .map(|note| note_ref(right.document_id, note))
                            .collect(),
                        matched_multiplicity,
                        unmatched_left_multiplicity: left_group.len() - matched_multiplicity,
                        unmatched_right_multiplicity: right_group.len() - matched_multiplicity,
                    });
                }

                left_index = left_end;
                right_index = right_end;
            }
        }
    }

    unmatched_left.extend(
        left_notes[left_index..]
            .iter()
            .map(|note| note_ref(left.document_id, note)),
    );
    unmatched_right.extend(
        right_notes[right_index..]
            .iter()
            .map(|note| note_ref(right.document_id, note)),
    );

    Ok(StrictNoteMatchResult {
        matcher_version: NOTE_CORRESPONDENCE_MATCHER_VERSION,
        policy: NoteMatchPolicy::StrictRoundTripV1,
        exact_match_multiplicity,
        exact_pairs,
        ambiguous_exact_groups,
        unmatched_left,
        unmatched_right,
    })
}

/// Finds tolerant cross-import candidates after exact content has been
/// drained. A candidate requires identical pitch and onset/duration deltas no
/// greater than one sixty-fourth of a quarter note; channel/velocity affect
/// only its later score, not eligibility.
pub(crate) fn discover_cross_import_candidates(
    left: MatchDocument<'_>,
    right: MatchDocument<'_>,
) -> Result<CrossImportCandidateResult, ContentMatchError> {
    let exact = match_strict_notes(
        MatchDocument {
            document_id: left.document_id,
            ppq: left.ppq,
            notes: left.notes,
        },
        MatchDocument {
            document_id: right.document_id,
            ppq: right.ppq,
            notes: right.notes,
        },
    )?;
    let consumed_left = consumed_note_ids(&exact, true);
    let consumed_right = consumed_note_ids(&exact, false);
    let left_notes = canonicalize_notes(left.notes, left.ppq)?;
    let right_notes = canonicalize_notes(right.notes, right.ppq)?;
    let mut fuzzy_candidates = Vec::new();

    for left_note in left_notes
        .iter()
        .filter(|note| !consumed_left.contains(note.note_id.as_str()))
    {
        for right_note in right_notes
            .iter()
            .filter(|note| !consumed_right.contains(note.note_id.as_str()))
        {
            if left_note.atom.pitch != right_note.atom.pitch {
                continue;
            }
            let onset_distance = rational_distance(
                left_note.atom.start_quarters,
                right_note.atom.start_quarters,
            );
            let duration_distance =
                rational_distance_between(duration(left_note.atom), duration(right_note.atom));
            if !within_cross_import_threshold(onset_distance)
                || !within_cross_import_threshold(duration_distance)
            {
                continue;
            }
            fuzzy_candidates.push(FuzzyNoteCandidate {
                left: note_ref(left.document_id, left_note),
                right: note_ref(right.document_id, right_note),
                onset_distance,
                duration_distance,
                same_channel: left_note.atom.channel == right_note.atom.channel,
                velocity_difference: left_note.atom.velocity.abs_diff(right_note.atom.velocity),
            });
        }
    }
    fuzzy_candidates.sort_by(compare_fuzzy_candidates);

    Ok(CrossImportCandidateResult {
        matcher_version: NOTE_CORRESPONDENCE_MATCHER_VERSION,
        policy: NoteMatchPolicy::CrossImportV1,
        exact,
        fuzzy_candidates,
    })
}

/// Resolves B1's scored candidates without ever using output order as an
/// identity tie-breaker. A pair is accepted only when it is the unique best
/// candidate for both endpoints; every other edge stays visible as ambiguity.
pub(crate) fn resolve_cross_import_candidates(
    candidates: CrossImportCandidateResult,
    left_total: usize,
    right_total: usize,
) -> CrossImportMatchResult {
    let mut fuzzy_pairs = Vec::new();
    let mut ambiguous_fuzzy_candidates = Vec::new();
    for candidate in &candidates.fuzzy_candidates {
        let left_edges: Vec<_> = candidates
            .fuzzy_candidates
            .iter()
            .filter(|edge| edge.left == candidate.left)
            .collect();
        let right_edges: Vec<_> = candidates
            .fuzzy_candidates
            .iter()
            .filter(|edge| edge.right == candidate.right)
            .collect();
        let unique_left = uniquely_best(candidate, &left_edges);
        let unique_right = uniquely_best(candidate, &right_edges);
        if unique_left && unique_right {
            fuzzy_pairs.push(FuzzyMatchedNotePair {
                left: candidate.left.clone(),
                right: candidate.right.clone(),
                onset_distance: candidate.onset_distance,
                duration_distance: candidate.duration_distance,
                same_channel: candidate.same_channel,
                velocity_difference: candidate.velocity_difference,
            });
        } else {
            ambiguous_fuzzy_candidates.push(candidate.clone());
        }
    }
    let fuzzy_left: HashSet<_> = fuzzy_pairs.iter().map(|pair| pair.left.clone()).collect();
    let fuzzy_right: HashSet<_> = fuzzy_pairs.iter().map(|pair| pair.right.clone()).collect();
    let ambiguous_left: HashSet<_> = ambiguous_fuzzy_candidates
        .iter()
        .map(|candidate| candidate.left.clone())
        .collect();
    let ambiguous_right: HashSet<_> = ambiguous_fuzzy_candidates
        .iter()
        .map(|candidate| candidate.right.clone())
        .collect();
    let unmatched_left: Vec<_> = candidates
        .exact
        .unmatched_left
        .iter()
        .filter(|note_ref| !fuzzy_left.contains(*note_ref) && !ambiguous_left.contains(*note_ref))
        .cloned()
        .collect();
    let unmatched_right: Vec<_> = candidates
        .exact
        .unmatched_right
        .iter()
        .filter(|note_ref| !fuzzy_right.contains(*note_ref) && !ambiguous_right.contains(*note_ref))
        .cloned()
        .collect();
    let exact = candidates.exact.exact_match_multiplicity;
    let fuzzy = fuzzy_pairs.len();
    let left_coverage = coverage(
        left_total,
        exact,
        fuzzy,
        &unmatched_left,
        &ambiguous_fuzzy_candidates,
        true,
    );
    let right_coverage = coverage(
        right_total,
        exact,
        fuzzy,
        &unmatched_right,
        &ambiguous_fuzzy_candidates,
        false,
    );
    let comparable = covers_half(&left_coverage) && covers_half(&right_coverage);
    CrossImportMatchResult {
        matcher_version: candidates.matcher_version,
        policy: candidates.policy,
        comparable,
        incomparable_reason: (!comparable).then_some(IncomparableReason::InsufficientCoverage),
        left_coverage,
        right_coverage,
        exact_pairs: candidates.exact.exact_pairs,
        fuzzy_pairs,
        ambiguous_fuzzy_candidates,
        unmatched_left,
        unmatched_right,
    }
}

fn score_less(left: &FuzzyNoteCandidate, right: &FuzzyNoteCandidate) -> bool {
    compare_fuzzy_score(left, right).is_lt()
}

fn uniquely_best(candidate: &FuzzyNoteCandidate, edges: &[&FuzzyNoteCandidate]) -> bool {
    edges.iter().all(|other| {
        (candidate.left == other.left && candidate.right == other.right)
            || score_less(candidate, other)
    })
}

fn coverage(
    total: usize,
    exact: usize,
    fuzzy: usize,
    unmatched: &[MatchNoteRef],
    ambiguous: &[FuzzyNoteCandidate],
    left: bool,
) -> MatchCoverage {
    let ambiguous = ambiguous
        .iter()
        .map(|edge| if left { &edge.left } else { &edge.right })
        .collect::<HashSet<_>>()
        .len();
    MatchCoverage {
        total,
        exact,
        fuzzy,
        ambiguous,
        unmatched: unmatched.len(),
    }
}

fn covers_half(coverage: &MatchCoverage) -> bool {
    coverage.total == 0 || (coverage.exact + coverage.fuzzy) * 2 >= coverage.total
}

fn consumed_note_ids(result: &StrictNoteMatchResult, left: bool) -> HashSet<&str> {
    let pairs = result
        .exact_pairs
        .iter()
        .map(|pair| if left { &pair.left } else { &pair.right });
    let ambiguous = result.ambiguous_exact_groups.iter().flat_map(|group| {
        if left {
            group.left.iter()
        } else {
            group.right.iter()
        }
    });
    pairs
        .chain(ambiguous)
        .map(|note| note.note_id.as_str())
        .collect()
}

fn duration(atom: CanonicalNoteAtom) -> RationalQuarterDistance {
    rational_distance(atom.end_quarters, atom.start_quarters)
}

fn rational_distance(left: RationalQuarter, right: RationalQuarter) -> RationalQuarterDistance {
    let left_scaled = u128::from(left.numerator) * u128::from(right.denominator);
    let right_scaled = u128::from(right.numerator) * u128::from(left.denominator);
    RationalQuarterDistance {
        numerator: left_scaled.abs_diff(right_scaled),
        denominator: u128::from(left.denominator) * u128::from(right.denominator),
    }
}

fn rational_distance_between(
    left: RationalQuarterDistance,
    right: RationalQuarterDistance,
) -> RationalQuarterDistance {
    RationalQuarterDistance {
        numerator: (left.numerator * right.denominator)
            .abs_diff(right.numerator * left.denominator),
        denominator: left.denominator * right.denominator,
    }
}

fn within_cross_import_threshold(distance: RationalQuarterDistance) -> bool {
    distance.numerator * 64 <= distance.denominator
}

fn compare_fuzzy_candidates(
    left: &FuzzyNoteCandidate,
    right: &FuzzyNoteCandidate,
) -> std::cmp::Ordering {
    compare_fuzzy_score(left, right)
        .then_with(|| left.left.cmp(&right.left))
        .then_with(|| left.right.cmp(&right.right))
}

fn compare_fuzzy_score(
    left: &FuzzyNoteCandidate,
    right: &FuzzyNoteCandidate,
) -> std::cmp::Ordering {
    compare_distance(left.onset_distance, right.onset_distance)
        .then_with(|| compare_distance(left.duration_distance, right.duration_distance))
        .then_with(|| right.same_channel.cmp(&left.same_channel))
        .then_with(|| left.velocity_difference.cmp(&right.velocity_difference))
}

fn compare_distance(
    left: RationalQuarterDistance,
    right: RationalQuarterDistance,
) -> std::cmp::Ordering {
    (left.numerator * right.denominator).cmp(&(right.numerator * left.denominator))
}

fn atom_group_end(notes: &[CanonicalNote], start: usize) -> usize {
    let atom = notes[start].atom;
    notes[start..]
        .iter()
        .position(|note| note.atom != atom)
        .map_or(notes.len(), |offset| start + offset)
}

fn note_ref(document_id: &str, note: &CanonicalNote) -> MatchNoteRef {
    MatchNoteRef {
        document_id: document_id.to_string(),
        note_id: note.note_id.clone(),
    }
}

fn local_note_refs(document: &MatchDocument<'_>) -> Vec<MatchNoteRef> {
    let mut refs: Vec<_> = document
        .notes
        .iter()
        .map(|note| MatchNoteRef {
            document_id: document.document_id.to_string(),
            note_id: note.id.clone(),
        })
        .collect();
    refs.sort();
    refs
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

    fn document<'a>(document_id: &'a str, ppq: u16, notes: &'a [MidiNoteDto]) -> MatchDocument<'a> {
        MatchDocument {
            document_id,
            ppq,
            notes,
        }
    }

    #[test]
    fn same_document_pairs_only_shared_local_ids_without_content_matching() {
        let left = vec![note("shared", 0, 120), note("left-only", 120, 240)];
        let mut changed = note("shared", 720, 960);
        changed.pitch = 71;
        changed.channel = 9;
        let right = vec![changed, note("right-only", 120, 240)];

        let result = match_same_document_notes(
            document("document-a", 960, &left),
            document("document-a", 0, &right),
        );

        assert!(result.comparable);
        assert_eq!(result.policy, NoteMatchPolicy::SameDocumentV1);
        assert_eq!(result.local_id_pairs.len(), 1);
        assert_eq!(result.local_id_pairs[0].left.note_id, "shared");
        assert_eq!(result.unmatched_left[0].note_id, "left-only");
        assert_eq!(result.unmatched_right[0].note_id, "right-only");
    }

    #[test]
    fn same_document_refuses_different_document_ids_without_content_fallback() {
        let left = vec![note("shared", 0, 120)];
        let right = vec![note("shared", 0, 120)];

        let result = match_same_document_notes(
            document("document-a", 960, &left),
            document("document-b", 960, &right),
        );

        assert!(!result.comparable);
        assert_eq!(
            result.incomparable_reason,
            Some(IncomparableReason::DifferentDocumentIds)
        );
        assert!(result.local_id_pairs.is_empty());
        assert_eq!(result.unmatched_left.len(), 1);
        assert_eq!(result.unmatched_right.len(), 1);
    }

    #[test]
    fn strictly_matches_equivalent_content_across_ppqs() {
        let left = vec![note("left-note", 120, 360)];
        let right = vec![note("right-note", 240, 720)];

        let result =
            match_strict_notes(document("left", 480, &left), document("right", 960, &right))
                .unwrap();

        assert_eq!(result.matcher_version, NOTE_CORRESPONDENCE_MATCHER_VERSION);
        assert_eq!(result.policy, NoteMatchPolicy::StrictRoundTripV1);
        assert_eq!(
            result.exact_pairs,
            vec![MatchedNotePair {
                left: MatchNoteRef {
                    document_id: "left".to_string(),
                    note_id: "left-note".to_string(),
                },
                right: MatchNoteRef {
                    document_id: "right".to_string(),
                    note_id: "right-note".to_string(),
                },
            }]
        );
        assert!(result.unmatched_left.is_empty());
        assert!(result.unmatched_right.is_empty());
    }

    #[test]
    fn strict_matching_requires_every_atom_field_to_match() {
        let original = note("left-note", 120, 360);
        let mut changed_pitch = note("right-note", 120, 360);
        changed_pitch.pitch += 1;
        let mut changed_channel = note("right-note", 120, 360);
        changed_channel.channel += 1;
        let mut changed_velocity = note("right-note", 120, 360);
        changed_velocity.velocity += 1;
        let changed_start = note("right-note", 121, 360);
        let changed_end = note("right-note", 120, 361);

        for changed in [
            changed_pitch,
            changed_channel,
            changed_velocity,
            changed_start,
            changed_end,
        ] {
            let result = match_strict_notes(
                document("left", 480, std::slice::from_ref(&original)),
                document("right", 480, std::slice::from_ref(&changed)),
            )
            .unwrap();
            assert!(result.exact_pairs.is_empty());
            assert_eq!(result.unmatched_left.len(), 1);
            assert_eq!(result.unmatched_right.len(), 1);
        }
    }

    #[test]
    fn strict_matching_is_input_order_invariant() {
        let mut left_low = note("left-low", 10, 20);
        left_low.pitch = 59;
        let left_high = note("left-high", 30, 40);
        let mut right_low = note("right-low", 10, 20);
        right_low.pitch = 59;
        let right_high = note("right-high", 30, 40);

        let forward_left = vec![left_high.clone(), left_low.clone()];
        let forward_right = vec![right_low.clone(), right_high.clone()];
        let reverse_left = vec![left_low, left_high];
        let reverse_right = vec![right_high, right_low];

        assert_eq!(
            match_strict_notes(
                document("left", 480, &forward_left),
                document("right", 480, &forward_right),
            )
            .unwrap(),
            match_strict_notes(
                document("left", 480, &reverse_left),
                document("right", 480, &reverse_right),
            )
            .unwrap()
        );
    }

    #[test]
    fn strictly_reports_equal_duplicate_multisets_as_ambiguous_exact_content() {
        let left = vec![note("left-1", 120, 360), note("left-2", 120, 360)];
        let right = vec![note("right-1", 120, 360), note("right-2", 120, 360)];

        let result =
            match_strict_notes(document("left", 480, &left), document("right", 480, &right))
                .unwrap();

        assert!(result.exact_pairs.is_empty());
        assert_eq!(result.exact_match_multiplicity, 2);
        assert_eq!(result.ambiguous_exact_groups.len(), 1);
        assert_eq!(result.ambiguous_exact_groups[0].matched_multiplicity, 2);
        assert_eq!(
            result.ambiguous_exact_groups[0].unmatched_left_multiplicity,
            0
        );
        assert_eq!(
            result.ambiguous_exact_groups[0].unmatched_right_multiplicity,
            0
        );
        assert_eq!(
            result.ambiguous_exact_groups[0].left,
            vec![
                MatchNoteRef {
                    document_id: "left".to_string(),
                    note_id: "left-1".to_string(),
                },
                MatchNoteRef {
                    document_id: "left".to_string(),
                    note_id: "left-2".to_string(),
                },
            ]
        );
        assert_eq!(
            result.ambiguous_exact_groups[0].right,
            vec![
                MatchNoteRef {
                    document_id: "right".to_string(),
                    note_id: "right-1".to_string(),
                },
                MatchNoteRef {
                    document_id: "right".to_string(),
                    note_id: "right-2".to_string(),
                },
            ]
        );
        assert!(result.unmatched_left.is_empty());
        assert!(result.unmatched_right.is_empty());
    }

    #[test]
    fn preserves_unequal_duplicate_multiplicity_without_arbitrarily_naming_the_extra_note() {
        let left = vec![
            note("left-1", 120, 360),
            note("left-2", 120, 360),
            note("left-3", 120, 360),
        ];
        let right = vec![note("right-1", 120, 360), note("right-2", 120, 360)];

        let result =
            match_strict_notes(document("left", 480, &left), document("right", 480, &right))
                .unwrap();

        assert_eq!(result.exact_match_multiplicity, 2);
        assert_eq!(result.ambiguous_exact_groups.len(), 1);
        assert_eq!(result.ambiguous_exact_groups[0].matched_multiplicity, 2);
        assert_eq!(
            result.ambiguous_exact_groups[0].unmatched_left_multiplicity,
            1
        );
        assert_eq!(
            result.ambiguous_exact_groups[0].unmatched_right_multiplicity,
            0
        );
        assert!(result.unmatched_left.is_empty());
        assert!(result.unmatched_right.is_empty());
    }

    #[test]
    fn does_not_group_duplicates_when_channel_or_velocity_differs() {
        let left = vec![note("left-1", 120, 360), note("left-2", 120, 360)];
        let mut different_channel = note("right-channel", 120, 360);
        different_channel.channel += 1;
        let mut different_velocity = note("right-velocity", 120, 360);
        different_velocity.velocity += 1;
        let right = vec![different_channel, different_velocity];

        let result =
            match_strict_notes(document("left", 480, &left), document("right", 480, &right))
                .unwrap();

        assert_eq!(result.exact_match_multiplicity, 0);
        assert!(result.ambiguous_exact_groups.is_empty());
        assert_eq!(result.unmatched_left.len(), 2);
        assert_eq!(result.unmatched_right.len(), 2);
    }

    #[test]
    fn duplicate_ambiguity_is_input_order_invariant() {
        let first_left = note("left-1", 120, 360);
        let second_left = note("left-2", 120, 360);
        let first_right = note("right-1", 120, 360);
        let second_right = note("right-2", 120, 360);
        let forward_left = vec![first_left.clone(), second_left.clone()];
        let forward_right = vec![first_right.clone(), second_right.clone()];
        let reversed_left = vec![second_left, first_left];
        let reversed_right = vec![second_right, first_right];

        assert_eq!(
            match_strict_notes(
                document("left", 480, &forward_left),
                document("right", 480, &forward_right),
            )
            .unwrap(),
            match_strict_notes(
                document("left", 480, &reversed_left),
                document("right", 480, &reversed_right),
            )
            .unwrap()
        );
    }

    #[test]
    fn strict_matching_handles_empty_documents() {
        let left: Vec<MidiNoteDto> = Vec::new();
        let right: Vec<MidiNoteDto> = Vec::new();

        assert_eq!(
            match_strict_notes(document("left", 480, &left), document("right", 480, &right))
                .unwrap(),
            StrictNoteMatchResult {
                matcher_version: NOTE_CORRESPONDENCE_MATCHER_VERSION,
                policy: NoteMatchPolicy::StrictRoundTripV1,
                exact_match_multiplicity: 0,
                exact_pairs: Vec::new(),
                ambiguous_exact_groups: Vec::new(),
                unmatched_left: Vec::new(),
                unmatched_right: Vec::new(),
            }
        );
    }

    #[test]
    fn cross_import_accepts_the_inclusive_timing_boundary_but_rejects_the_next_tick() {
        let left = vec![note("left", 0, 960)];
        let at_boundary = vec![note("right", 15, 975)];
        let beyond_boundary = vec![note("right", 16, 976)];

        let accepted = discover_cross_import_candidates(
            document("left", 960, &left),
            document("right", 960, &at_boundary),
        )
        .unwrap();
        let rejected = discover_cross_import_candidates(
            document("left", 960, &left),
            document("right", 960, &beyond_boundary),
        )
        .unwrap();

        assert_eq!(accepted.policy, NoteMatchPolicy::CrossImportV1);
        assert_eq!(accepted.fuzzy_candidates.len(), 1);
        assert_eq!(accepted.fuzzy_candidates[0].onset_distance.numerator, 1);
        assert_eq!(accepted.fuzzy_candidates[0].onset_distance.denominator, 64);
        assert!(rejected.fuzzy_candidates.is_empty());
    }

    #[test]
    fn cross_import_requires_equal_pitch_but_scores_channel_and_velocity() {
        let left = vec![note("left", 0, 960)];
        let mut compatible = note("right", 7, 967);
        compatible.channel = 3;
        compatible.velocity = 91;
        let mut wrong_pitch = compatible.clone();
        wrong_pitch.pitch += 1;

        let compatible_result = discover_cross_import_candidates(
            document("left", 960, &left),
            document("right", 960, std::slice::from_ref(&compatible)),
        )
        .unwrap();
        let wrong_pitch_result = discover_cross_import_candidates(
            document("left", 960, &left),
            document("right", 960, std::slice::from_ref(&wrong_pitch)),
        )
        .unwrap();

        assert_eq!(compatible_result.fuzzy_candidates.len(), 1);
        assert!(!compatible_result.fuzzy_candidates[0].same_channel);
        assert_eq!(compatible_result.fuzzy_candidates[0].velocity_difference, 9);
        assert!(wrong_pitch_result.fuzzy_candidates.is_empty());
    }

    #[test]
    fn cross_import_drains_exact_pairs_before_discovering_nearby_candidates() {
        let left = vec![note("exact-left", 0, 480), note("near-left", 960, 1440)];
        let right = vec![note("exact-right", 0, 480), note("near-right", 968, 1448)];

        let result = discover_cross_import_candidates(
            document("left", 960, &left),
            document("right", 960, &right),
        )
        .unwrap();

        assert_eq!(result.exact.exact_pairs.len(), 1);
        assert_eq!(result.fuzzy_candidates.len(), 1);
        assert_eq!(result.fuzzy_candidates[0].left.note_id, "near-left");
        assert_eq!(result.fuzzy_candidates[0].right.note_id, "near-right");
    }

    #[test]
    fn resolves_only_a_mutually_unique_fuzzy_candidate() {
        let left = vec![note("left", 0, 960)];
        let right = vec![note("right", 7, 967)];
        let result = resolve_cross_import_candidates(
            discover_cross_import_candidates(
                document("left", 960, &left),
                document("right", 960, &right),
            )
            .unwrap(),
            1,
            1,
        );
        assert!(result.comparable);
        assert_eq!(result.fuzzy_pairs.len(), 1);
        assert!(result.ambiguous_fuzzy_candidates.is_empty());
        assert!(result.unmatched_left.is_empty());
        assert!(result.unmatched_right.is_empty());
    }

    #[test]
    fn preserves_tied_fuzzy_candidates_as_ambiguity() {
        let left = vec![note("left", 0, 960)];
        let right = vec![note("right-a", 7, 967), note("right-b", 7, 967)];
        let result = resolve_cross_import_candidates(
            discover_cross_import_candidates(
                document("left", 960, &left),
                document("right", 960, &right),
            )
            .unwrap(),
            1,
            2,
        );
        assert!(result.fuzzy_pairs.is_empty());
        assert_eq!(result.ambiguous_fuzzy_candidates.len(), 2);
        assert!(result.unmatched_left.is_empty());
        assert!(result.unmatched_right.is_empty());
        assert!(!result.comparable);
        assert_eq!(
            result.incomparable_reason,
            Some(IncomparableReason::InsufficientCoverage)
        );
    }

    #[test]
    fn accepts_exactly_fifty_percent_coverage_but_rejects_asymmetric_low_coverage() {
        let left = vec![note("exact-left", 0, 480), note("extra-left", 960, 1440)];
        let mut extra_right = note("extra-right", 960, 1440);
        extra_right.pitch += 1;
        let right = vec![note("exact-right", 0, 480), extra_right];
        let boundary = resolve_cross_import_candidates(
            discover_cross_import_candidates(
                document("left", 960, &left),
                document("right", 960, &right),
            )
            .unwrap(),
            2,
            2,
        );
        assert!(boundary.comparable);
        let asymmetric = resolve_cross_import_candidates(
            discover_cross_import_candidates(
                document("left", 960, &left),
                document("right", 960, &right),
            )
            .unwrap(),
            3,
            1,
        );
        assert!(!asymmetric.comparable);
    }
}
