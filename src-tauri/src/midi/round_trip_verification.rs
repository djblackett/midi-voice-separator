use super::{
    content_matching::{
        match_strict_notes, ContentMatchError, MatchDocument, NoteMatchPolicy,
        StrictNoteMatchResult,
    },
    model::{
        NoteMatchPolicyDto, NoteRefDto, StrictAmbiguousNoteMatchGroupDto,
        StrictRoundTripVerificationDto,
    },
};

/// Bump when the semantic report changes meaning. This is separate from the
/// matcher version so presentation can distinguish verifier-policy evolution
/// from canonical note correspondence evolution.
pub(crate) const ROUND_TRIP_VERIFIER_VERSION: u32 = 1;

/// Pure, strict note-content evidence. A later verifier combines this with
/// voice partition, labels/roles, PPQ/duration, and timeline metadata before
/// presenting any final `Verified` claim to the user.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StrictRoundTripVerification {
    pub verifier_version: u32,
    pub expected_note_count: usize,
    pub reimported_note_count: usize,
    pub strict: StrictNoteMatchResult,
}

/// Uses only the strict exact-multiset policy. There is intentionally no
/// tolerant fallback in this module: an export timing or content change must
/// remain visible to the final round-trip report.
pub(crate) fn verify_strict_note_content(
    expected: MatchDocument<'_>,
    reimported: MatchDocument<'_>,
) -> Result<StrictRoundTripVerification, ContentMatchError> {
    let expected_note_count = expected.notes.len();
    let reimported_note_count = reimported.notes.len();
    let strict = match_strict_notes(expected, reimported)?;
    Ok(StrictRoundTripVerification {
        verifier_version: ROUND_TRIP_VERIFIER_VERSION,
        expected_note_count,
        reimported_note_count,
        strict,
    })
}

pub(crate) fn strict_round_trip_verification_dto(
    verification: &StrictRoundTripVerification,
) -> StrictRoundTripVerificationDto {
    StrictRoundTripVerificationDto {
        verifier_version: verification.verifier_version,
        matcher_version: verification.strict.matcher_version,
        policy: note_match_policy_dto(verification.strict.policy),
        expected_note_count: verification.expected_note_count,
        reimported_note_count: verification.reimported_note_count,
        exact_match_multiplicity: verification.strict.exact_match_multiplicity,
        content_preserved: verification.strict.unmatched_left.is_empty()
            && verification.strict.unmatched_right.is_empty(),
        ambiguous_exact_groups: verification
            .strict
            .ambiguous_exact_groups
            .iter()
            .map(|group| StrictAmbiguousNoteMatchGroupDto {
                expected: group.left.iter().map(note_ref_dto).collect(),
                reimported: group.right.iter().map(note_ref_dto).collect(),
                matched_multiplicity: group.matched_multiplicity,
            })
            .collect(),
        missing_expected: verification
            .strict
            .unmatched_left
            .iter()
            .map(note_ref_dto)
            .collect(),
        unexpected_reimported: verification
            .strict
            .unmatched_right
            .iter()
            .map(note_ref_dto)
            .collect(),
    }
}

fn note_match_policy_dto(policy: NoteMatchPolicy) -> NoteMatchPolicyDto {
    match policy {
        NoteMatchPolicy::SameDocumentV1 => NoteMatchPolicyDto::SameDocumentV1,
        NoteMatchPolicy::StrictRoundTripV1 => NoteMatchPolicyDto::StrictRoundTripV1,
        NoteMatchPolicy::CrossImportV1 => NoteMatchPolicyDto::CrossImportV1,
    }
}

fn note_ref_dto(note_ref: &super::content_matching::MatchNoteRef) -> NoteRefDto {
    NoteRefDto {
        document_id: note_ref.document_id.clone(),
        note_id: note_ref.note_id.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::midi::model::{AssignmentReason, MidiNoteDto};

    fn note(id: &str, pitch: u8, start_tick: u64, end_tick: u64) -> MidiNoteDto {
        MidiNoteDto {
            id: id.to_string(),
            voice_id: "voice-1".to_string(),
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

    fn document<'a>(document_id: &'a str, ppq: u16, notes: &'a [MidiNoteDto]) -> MatchDocument<'a> {
        MatchDocument {
            document_id,
            ppq,
            notes,
        }
    }

    #[test]
    fn verifies_exact_content_across_equivalent_ppqs() {
        let expected = vec![note("expected", 60, 240, 720)];
        let reimported = vec![note("reimported", 60, 480, 1440)];

        let verification = verify_strict_note_content(
            document("expected-export", 480, &expected),
            document("reimported-export", 960, &reimported),
        )
        .expect("equivalent quarter-note positions should verify");
        let dto = strict_round_trip_verification_dto(&verification);

        assert!(dto.content_preserved);
        assert_eq!(dto.policy, NoteMatchPolicyDto::StrictRoundTripV1);
        assert_eq!(dto.exact_match_multiplicity, 1);
        assert!(dto.missing_expected.is_empty());
        assert!(dto.unexpected_reimported.is_empty());
    }

    #[test]
    fn reports_changed_content_as_missing_and_unexpected_without_tolerance() {
        let expected = vec![note("expected", 60, 0, 480)];
        let reimported = vec![note("reimported", 60, 1, 480)];

        let verification = verify_strict_note_content(
            document("expected-export", 480, &expected),
            document("reimported-export", 480, &reimported),
        )
        .expect("well-formed notes should compare");
        let dto = strict_round_trip_verification_dto(&verification);

        assert!(!dto.content_preserved);
        assert_eq!(dto.exact_match_multiplicity, 0);
        assert_eq!(dto.missing_expected[0].document_id, "expected-export");
        assert_eq!(
            dto.unexpected_reimported[0].document_id,
            "reimported-export"
        );
    }

    #[test]
    fn preserves_duplicate_multiset_content_without_fabricating_occurrence_pairs() {
        let expected = vec![
            note("expected-a", 60, 0, 480),
            note("expected-b", 60, 0, 480),
        ];
        let reimported = vec![
            note("reimported-a", 60, 0, 480),
            note("reimported-b", 60, 0, 480),
        ];

        let verification = verify_strict_note_content(
            document("expected-export", 480, &expected),
            document("reimported-export", 480, &reimported),
        )
        .expect("equal duplicate multisets should compare");
        let dto = strict_round_trip_verification_dto(&verification);

        assert!(dto.content_preserved);
        assert_eq!(dto.exact_match_multiplicity, 2);
        assert_eq!(dto.ambiguous_exact_groups.len(), 1);
        assert_eq!(dto.ambiguous_exact_groups[0].expected.len(), 2);
        assert_eq!(dto.ambiguous_exact_groups[0].reimported.len(), 2);
    }

    #[test]
    fn report_is_input_order_invariant() {
        let expected = vec![
            note("expected-b", 72, 480, 960),
            note("expected-a", 60, 0, 480),
        ];
        let reimported = vec![
            note("reimported-b", 72, 480, 960),
            note("reimported-a", 60, 0, 480),
        ];
        let mut reversed_expected = expected.clone();
        let mut reversed_reimported = reimported.clone();
        reversed_expected.reverse();
        reversed_reimported.reverse();

        let ordered = strict_round_trip_verification_dto(
            &verify_strict_note_content(
                document("expected-export", 480, &expected),
                document("reimported-export", 480, &reimported),
            )
            .unwrap(),
        );
        let reversed = strict_round_trip_verification_dto(
            &verify_strict_note_content(
                document("expected-export", 480, &reversed_expected),
                document("reimported-export", 480, &reversed_reimported),
            )
            .unwrap(),
        );

        assert_eq!(ordered, reversed);
    }
}
