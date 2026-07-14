use super::{
    content_matching::{
        match_strict_notes, ContentMatchError, MatchDocument, NoteMatchPolicy,
        StrictNoteMatchResult, NOTE_CORRESPONDENCE_MATCHER_VERSION,
    },
    export_validation::export_project_diagnostics,
    model::{
        MidiProjectDto, NoteMatchPolicyDto, NoteRefDto, RoundTripDifferenceDto,
        RoundTripDifferenceKindDto, RoundTripVerificationReportDto, RoundTripVerificationStatusDto,
        StrictAmbiguousNoteMatchGroupDto, StrictNoteVerificationSummaryDto,
        StrictRoundTripVerificationDto, TimelineMetadataVerificationDto,
        VoicePartitionVerificationDto,
    },
};
use std::collections::{BTreeMap, BTreeSet};

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

/// A successful write whose destination cannot subsequently be read, parsed,
/// or compared still returns a complete, explicitly non-semantic result. It
/// must never be mistaken for missing notes or an ordinary model difference.
pub(crate) fn could_not_verify_round_trip_report(
    expected: &MidiProjectDto,
) -> RoundTripVerificationReportDto {
    RoundTripVerificationReportDto {
        verifier_version: ROUND_TRIP_VERIFIER_VERSION,
        matcher_version: NOTE_CORRESPONDENCE_MATCHER_VERSION,
        policy: NoteMatchPolicyDto::StrictRoundTripV1,
        status: RoundTripVerificationStatusDto::CouldNotVerify,
        note_summary: StrictNoteVerificationSummaryDto {
            expected_note_count: expected.notes.len(),
            reimported_note_count: 0,
            exact_match_multiplicity: 0,
            content_preserved: false,
            ambiguous_exact_group_count: 0,
            missing_expected: Vec::new(),
            unexpected_reimported: Vec::new(),
        },
        voice_partition: VoicePartitionVerificationDto {
            unambiguous_pair_count: 0,
            ambiguous_duplicate_group_count: 0,
            comparable: false,
            preserved: false,
        },
        metadata: TimelineMetadataVerificationDto {
            ppq_preserved: false,
            duration_preserved: false,
            tempo_map_preserved: false,
            time_signatures_preserved: false,
        },
        differences: Vec::new(),
    }
}

/// Verifies the complete supported semantic export model without writing a
/// file or invoking the parser. The command layer later supplies the actual
/// bytes read back from disk as `reimported`; keeping this pure makes every
/// verdict independent of UI state and filesystem behavior.
pub(crate) fn verify_round_trip_model(
    expected_document_id: &str,
    expected: &MidiProjectDto,
    reimported_document_id: &str,
    reimported: &MidiProjectDto,
) -> Result<RoundTripVerificationReportDto, ContentMatchError> {
    let strict = verify_strict_note_content(
        MatchDocument {
            document_id: expected_document_id,
            ppq: expected.ppq,
            notes: &expected.notes,
        },
        MatchDocument {
            document_id: reimported_document_id,
            ppq: reimported.ppq,
            notes: &reimported.notes,
        },
    )?;
    let note_summary = strict_note_summary(&strict);
    let metadata = timeline_metadata_verification(expected, reimported);
    let (voice_partition, mut differences) = verify_voice_partition(
        expected_document_id,
        expected,
        reimported_document_id,
        reimported,
        &strict.strict,
    );
    for overlap in export_project_diagnostics(expected).crossing_duplicate_overlaps {
        differences.push(RoundTripDifferenceDto {
            kind: RoundTripDifferenceKindDto::OverlappingDuplicatePairing,
            expected_notes: vec![
                NoteRefDto {
                    document_id: expected_document_id.to_string(),
                    note_id: overlap.first_note_id,
                },
                NoteRefDto {
                    document_id: expected_document_id.to_string(),
                    note_id: overlap.second_note_id,
                },
            ],
            reimported_notes: Vec::new(),
            expected_voice_id: Some(overlap.first_voice_id),
            reimported_voice_id: Some(overlap.second_voice_id),
        });
    }

    if !strict.strict.unmatched_left.is_empty() {
        differences.push(RoundTripDifferenceDto {
            kind: RoundTripDifferenceKindDto::MissingNote,
            expected_notes: strict
                .strict
                .unmatched_left
                .iter()
                .map(note_ref_dto)
                .collect(),
            reimported_notes: Vec::new(),
            expected_voice_id: None,
            reimported_voice_id: None,
        });
    }
    if !strict.strict.unmatched_right.is_empty() {
        differences.push(RoundTripDifferenceDto {
            kind: RoundTripDifferenceKindDto::UnexpectedNote,
            expected_notes: Vec::new(),
            reimported_notes: strict
                .strict
                .unmatched_right
                .iter()
                .map(note_ref_dto)
                .collect(),
            expected_voice_id: None,
            reimported_voice_id: None,
        });
    }
    append_metadata_differences(&metadata, &mut differences);
    sort_differences(&mut differences);

    let has_known_difference = differences.iter().any(|difference| {
        !matches!(
            difference.kind,
            RoundTripDifferenceKindDto::AmbiguousDuplicatePartition
                | RoundTripDifferenceKindDto::OverlappingDuplicatePairing
        )
    });
    let status = if !note_summary.content_preserved || has_known_difference {
        RoundTripVerificationStatusDto::DifferencesFound
    } else if !voice_partition.comparable
        || differences.iter().any(|difference| {
            matches!(
                difference.kind,
                RoundTripDifferenceKindDto::AmbiguousDuplicatePartition
                    | RoundTripDifferenceKindDto::OverlappingDuplicatePairing
            )
        })
    {
        RoundTripVerificationStatusDto::Inconclusive
    } else {
        RoundTripVerificationStatusDto::Verified
    };

    Ok(RoundTripVerificationReportDto {
        verifier_version: strict.verifier_version,
        matcher_version: strict.strict.matcher_version,
        policy: note_match_policy_dto(strict.strict.policy),
        status,
        note_summary,
        voice_partition,
        metadata,
        differences,
    })
}

fn strict_note_summary(
    verification: &StrictRoundTripVerification,
) -> StrictNoteVerificationSummaryDto {
    StrictNoteVerificationSummaryDto {
        expected_note_count: verification.expected_note_count,
        reimported_note_count: verification.reimported_note_count,
        exact_match_multiplicity: verification.strict.exact_match_multiplicity,
        content_preserved: verification.strict.unmatched_left.is_empty()
            && verification.strict.unmatched_right.is_empty(),
        ambiguous_exact_group_count: verification.strict.ambiguous_exact_groups.len(),
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

fn timeline_metadata_verification(
    expected: &MidiProjectDto,
    reimported: &MidiProjectDto,
) -> TimelineMetadataVerificationDto {
    TimelineMetadataVerificationDto {
        ppq_preserved: expected.ppq == reimported.ppq,
        duration_preserved: expected.duration_ticks == reimported.duration_ticks,
        tempo_map_preserved: expected.tempo_changes == reimported.tempo_changes,
        time_signatures_preserved: expected.time_signatures == reimported.time_signatures,
    }
}

fn append_metadata_differences(
    metadata: &TimelineMetadataVerificationDto,
    differences: &mut Vec<RoundTripDifferenceDto>,
) {
    for (preserved, kind) in [
        (metadata.ppq_preserved, RoundTripDifferenceKindDto::Ppq),
        (
            metadata.duration_preserved,
            RoundTripDifferenceKindDto::Duration,
        ),
        (
            metadata.tempo_map_preserved,
            RoundTripDifferenceKindDto::TempoMap,
        ),
        (
            metadata.time_signatures_preserved,
            RoundTripDifferenceKindDto::TimeSignatures,
        ),
    ] {
        if !preserved {
            differences.push(RoundTripDifferenceDto {
                kind,
                expected_notes: Vec::new(),
                reimported_notes: Vec::new(),
                expected_voice_id: None,
                reimported_voice_id: None,
            });
        }
    }
}

fn verify_voice_partition(
    expected_document_id: &str,
    expected: &MidiProjectDto,
    reimported_document_id: &str,
    reimported: &MidiProjectDto,
    strict: &StrictNoteMatchResult,
) -> (VoicePartitionVerificationDto, Vec<RoundTripDifferenceDto>) {
    let expected_note_voices = note_voice_ids(&expected.notes);
    let reimported_note_voices = note_voice_ids(&reimported.notes);
    let expected_voices = project_voices(expected);
    let reimported_voices = project_voices(reimported);
    let mut expected_to_reimported = BTreeMap::<String, BTreeSet<String>>::new();
    let mut reimported_to_expected = BTreeMap::<String, BTreeSet<String>>::new();
    let mut differences = Vec::new();

    for pair in &strict.exact_pairs {
        let Some(expected_voice_id) = expected_note_voices.get(pair.left.note_id.as_str()) else {
            differences.push(partition_difference(
                Some(&pair.left),
                Some(&pair.right),
                None,
                None,
            ));
            continue;
        };
        let Some(reimported_voice_id) = reimported_note_voices.get(pair.right.note_id.as_str())
        else {
            differences.push(partition_difference(
                Some(&pair.left),
                Some(&pair.right),
                None,
                None,
            ));
            continue;
        };

        expected_to_reimported
            .entry(expected_voice_id.clone())
            .or_default()
            .insert(reimported_voice_id.clone());
        reimported_to_expected
            .entry(reimported_voice_id.clone())
            .or_default()
            .insert(expected_voice_id.clone());
    }

    let conflicting_expected: BTreeSet<String> = expected_to_reimported
        .iter()
        .filter(|(_, targets)| targets.len() != 1)
        .map(|(voice_id, _)| voice_id.clone())
        .collect();
    let conflicting_reimported: BTreeSet<String> = reimported_to_expected
        .iter()
        .filter(|(_, sources)| sources.len() != 1)
        .map(|(voice_id, _)| voice_id.clone())
        .collect();
    if !conflicting_expected.is_empty() || !conflicting_reimported.is_empty() {
        let pairs = strict
            .exact_pairs
            .iter()
            .filter(|pair| {
                expected_note_voices
                    .get(pair.left.note_id.as_str())
                    .is_some_and(|voice_id| conflicting_expected.contains(voice_id))
                    || reimported_note_voices
                        .get(pair.right.note_id.as_str())
                        .is_some_and(|voice_id| conflicting_reimported.contains(voice_id))
            })
            .collect::<Vec<_>>();
        differences.push(RoundTripDifferenceDto {
            kind: RoundTripDifferenceKindDto::VoicePartition,
            expected_notes: pairs.iter().map(|pair| note_ref_dto(&pair.left)).collect(),
            reimported_notes: pairs.iter().map(|pair| note_ref_dto(&pair.right)).collect(),
            expected_voice_id: None,
            reimported_voice_id: None,
        });
    }

    let ambiguous_expected_voice_ids =
        ambiguous_voice_ids(strict, true, &expected_note_voices, expected_document_id);
    let ambiguous_reimported_voice_ids = ambiguous_voice_ids(
        strict,
        false,
        &reimported_note_voices,
        reimported_document_id,
    );
    for group in &strict.ambiguous_exact_groups {
        differences.push(RoundTripDifferenceDto {
            kind: RoundTripDifferenceKindDto::AmbiguousDuplicatePartition,
            expected_notes: group.left.iter().map(note_ref_dto).collect(),
            reimported_notes: group.right.iter().map(note_ref_dto).collect(),
            expected_voice_id: None,
            reimported_voice_id: None,
        });
    }

    for voice_id in nonempty_voice_ids(&expected_note_voices) {
        if !expected_to_reimported.contains_key(&voice_id)
            && !ambiguous_expected_voice_ids.contains(&voice_id)
        {
            differences.push(partition_difference(None, None, Some(voice_id), None));
        }
    }
    for voice_id in nonempty_voice_ids(&reimported_note_voices) {
        if !reimported_to_expected.contains_key(&voice_id)
            && !ambiguous_reimported_voice_ids.contains(&voice_id)
        {
            differences.push(partition_difference(None, None, None, Some(voice_id)));
        }
    }

    for (expected_voice_id, reimported_voice_ids) in &expected_to_reimported {
        if reimported_voice_ids.len() != 1 {
            continue;
        }
        let reimported_voice_id = reimported_voice_ids
            .iter()
            .next()
            .expect("one target was checked above");
        if reimported_to_expected
            .get(reimported_voice_id)
            .is_none_or(|expected_voice_ids| expected_voice_ids.len() != 1)
        {
            continue;
        }
        let (Some(expected_voice), Some(reimported_voice)) = (
            expected_voices.get(expected_voice_id.as_str()),
            reimported_voices.get(reimported_voice_id.as_str()),
        ) else {
            differences.push(partition_difference(
                None,
                None,
                Some(expected_voice_id.clone()),
                Some(reimported_voice_id.clone()),
            ));
            continue;
        };

        if expected_voice.label != reimported_voice.label {
            differences.push(voice_difference(
                RoundTripDifferenceKindDto::VoiceLabel,
                expected_voice_id,
                reimported_voice_id,
            ));
        }
        if expected_voice.role != reimported_voice.role {
            differences.push(voice_difference(
                RoundTripDifferenceKindDto::VoiceRole,
                expected_voice_id,
                reimported_voice_id,
            ));
        }
    }

    let comparable = strict.ambiguous_exact_groups.is_empty();
    let preserved = comparable
        && !differences.iter().any(|difference| {
            difference.kind != RoundTripDifferenceKindDto::AmbiguousDuplicatePartition
        });
    (
        VoicePartitionVerificationDto {
            unambiguous_pair_count: strict.exact_pairs.len(),
            ambiguous_duplicate_group_count: strict.ambiguous_exact_groups.len(),
            comparable,
            preserved,
        },
        differences,
    )
}

fn note_voice_ids(notes: &[super::model::MidiNoteDto]) -> BTreeMap<String, String> {
    notes
        .iter()
        .map(|note| (note.id.clone(), note.voice_id.clone()))
        .collect()
}

fn project_voices(project: &MidiProjectDto) -> BTreeMap<&str, &super::model::MidiVoiceDto> {
    project
        .voices
        .iter()
        .map(|voice| (voice.id.as_str(), voice))
        .collect()
}

fn ambiguous_voice_ids(
    strict: &StrictNoteMatchResult,
    expected_side: bool,
    note_voices: &BTreeMap<String, String>,
    document_id: &str,
) -> BTreeSet<String> {
    strict
        .ambiguous_exact_groups
        .iter()
        .flat_map(|group| {
            if expected_side {
                &group.left
            } else {
                &group.right
            }
        })
        .filter(|note_ref| note_ref.document_id == document_id)
        .filter_map(|note_ref| note_voices.get(note_ref.note_id.as_str()).cloned())
        .collect()
}

fn nonempty_voice_ids(note_voices: &BTreeMap<String, String>) -> BTreeSet<String> {
    note_voices.values().cloned().collect()
}

fn partition_difference(
    expected_note: Option<&super::content_matching::MatchNoteRef>,
    reimported_note: Option<&super::content_matching::MatchNoteRef>,
    expected_voice_id: Option<String>,
    reimported_voice_id: Option<String>,
) -> RoundTripDifferenceDto {
    RoundTripDifferenceDto {
        kind: RoundTripDifferenceKindDto::VoicePartition,
        expected_notes: expected_note.into_iter().map(note_ref_dto).collect(),
        reimported_notes: reimported_note.into_iter().map(note_ref_dto).collect(),
        expected_voice_id,
        reimported_voice_id,
    }
}

fn voice_difference(
    kind: RoundTripDifferenceKindDto,
    expected_voice_id: &str,
    reimported_voice_id: &str,
) -> RoundTripDifferenceDto {
    RoundTripDifferenceDto {
        kind,
        expected_notes: Vec::new(),
        reimported_notes: Vec::new(),
        expected_voice_id: Some(expected_voice_id.to_string()),
        reimported_voice_id: Some(reimported_voice_id.to_string()),
    }
}

fn sort_differences(differences: &mut [RoundTripDifferenceDto]) {
    for difference in differences.iter_mut() {
        difference.expected_notes.sort();
        difference.reimported_notes.sort();
    }
    differences.sort_by(|left, right| {
        left.kind
            .cmp(&right.kind)
            .then_with(|| left.expected_voice_id.cmp(&right.expected_voice_id))
            .then_with(|| left.reimported_voice_id.cmp(&right.reimported_voice_id))
            .then_with(|| left.expected_notes.cmp(&right.expected_notes))
            .then_with(|| left.reimported_notes.cmp(&right.reimported_notes))
    });
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
    use crate::midi::model::{
        AssignmentReason, MidiNoteDto, MidiProjectDto, MidiVoiceDto, SeparationStrategy,
        SeparationSummaryDto, StrategySuggestionDto, TempoChangeDto, TimeSignatureDto,
        VoiceRoleDto,
    };

    fn note(id: &str, pitch: u8, start_tick: u64, end_tick: u64) -> MidiNoteDto {
        note_in_voice(id, "voice-1", pitch, start_tick, end_tick)
    }

    fn note_in_voice(
        id: &str,
        voice_id: &str,
        pitch: u8,
        start_tick: u64,
        end_tick: u64,
    ) -> MidiNoteDto {
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

    fn voice(id: &str, label: &str, role: VoiceRoleDto) -> MidiVoiceDto {
        MidiVoiceDto {
            id: id.to_string(),
            label: label.to_string(),
            role,
            note_count: 1,
            lowest_pitch: 0,
            highest_pitch: 127,
        }
    }

    fn project(
        ppq: u16,
        duration_ticks: u64,
        notes: Vec<MidiNoteDto>,
        voices: Vec<MidiVoiceDto>,
    ) -> MidiProjectDto {
        let voice_count = voices.len();
        MidiProjectDto {
            file_name: "round-trip.mid".to_string(),
            format: "parallel".to_string(),
            ppq,
            duration_ticks,
            track_count: voices.len() + 1,
            voices,
            notes,
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
                voice_count,
            },
            strategy_suggestion: StrategySuggestionDto {
                strategy: SeparationStrategy::Balanced,
                reason: "test fixture".to_string(),
            },
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

    #[test]
    fn verifies_matching_partition_and_metadata_without_requiring_voice_ids() {
        let expected = project(
            480,
            960,
            vec![
                note_in_voice("expected-lead", "expected-lead", 72, 0, 480),
                note_in_voice("expected-bass", "expected-bass", 48, 480, 960),
            ],
            vec![
                voice("expected-lead", "Lead", VoiceRoleDto::Melodic),
                voice("expected-bass", "Bass", VoiceRoleDto::Melodic),
            ],
        );
        let reimported = project(
            480,
            960,
            vec![
                note_in_voice("reimported-bass", "voice-2", 48, 480, 960),
                note_in_voice("reimported-lead", "voice-1", 72, 0, 480),
            ],
            vec![
                voice("voice-1", "Lead", VoiceRoleDto::Melodic),
                voice("voice-2", "Bass", VoiceRoleDto::Melodic),
            ],
        );

        let report = verify_round_trip_model(
            "expected-export",
            &expected,
            "reimported-export",
            &reimported,
        )
        .expect("well-formed projects should compare");

        assert_eq!(report.status, RoundTripVerificationStatusDto::Verified);
        assert!(report.note_summary.content_preserved);
        assert!(report.voice_partition.preserved);
        assert!(report.metadata.ppq_preserved);
        assert!(report.differences.is_empty());
    }

    #[test]
    fn reports_exact_timeline_metadata_differences_after_strict_note_normalization() {
        let expected = project(
            480,
            960,
            vec![note_in_voice("expected", "voice-a", 60, 0, 480)],
            vec![voice("voice-a", "Lead", VoiceRoleDto::Melodic)],
        );
        let mut reimported = project(
            960,
            1_920,
            vec![note_in_voice("reimported", "voice-b", 60, 0, 960)],
            vec![voice("voice-b", "Lead", VoiceRoleDto::Melodic)],
        );
        reimported.tempo_changes[0].microseconds_per_quarter = 600_000;
        reimported.time_signatures[0].numerator = 3;

        let report = verify_round_trip_model(
            "expected-export",
            &expected,
            "reimported-export",
            &reimported,
        )
        .expect("well-formed projects should compare");

        assert!(report.note_summary.content_preserved);
        assert_eq!(
            report.status,
            RoundTripVerificationStatusDto::DifferencesFound
        );
        assert_eq!(
            report
                .differences
                .iter()
                .map(|difference| difference.kind)
                .collect::<Vec<_>>(),
            vec![
                RoundTripDifferenceKindDto::Ppq,
                RoundTripDifferenceKindDto::Duration,
                RoundTripDifferenceKindDto::TempoMap,
                RoundTripDifferenceKindDto::TimeSignatures,
            ],
        );
    }

    #[test]
    fn reports_partition_label_and_role_differences_from_unambiguous_pairs() {
        let expected = project(
            480,
            960,
            vec![note_in_voice("expected", "expected-lead", 60, 0, 480)],
            vec![voice("expected-lead", "Lead", VoiceRoleDto::Melodic)],
        );
        let reimported = project(
            480,
            960,
            vec![note_in_voice("reimported", "reimported-lead", 60, 0, 480)],
            vec![voice("reimported-lead", "Drums", VoiceRoleDto::Percussion)],
        );

        let report = verify_round_trip_model(
            "expected-export",
            &expected,
            "reimported-export",
            &reimported,
        )
        .expect("well-formed projects should compare");

        assert_eq!(
            report.status,
            RoundTripVerificationStatusDto::DifferencesFound
        );
        assert!(!report.voice_partition.preserved);
        assert_eq!(
            report
                .differences
                .iter()
                .map(|difference| difference.kind)
                .collect::<Vec<_>>(),
            vec![
                RoundTripDifferenceKindDto::VoiceLabel,
                RoundTripDifferenceKindDto::VoiceRole,
            ],
        );
    }

    #[test]
    fn reports_a_split_partition_without_inventing_note_correspondence() {
        let expected = project(
            480,
            960,
            vec![
                note_in_voice("expected-a", "expected-voice", 60, 0, 240),
                note_in_voice("expected-b", "expected-voice", 64, 240, 480),
            ],
            vec![voice("expected-voice", "Lead", VoiceRoleDto::Melodic)],
        );
        let reimported = project(
            480,
            960,
            vec![
                note_in_voice("reimported-a", "reimported-low", 60, 0, 240),
                note_in_voice("reimported-b", "reimported-high", 64, 240, 480),
            ],
            vec![
                voice("reimported-low", "Lead", VoiceRoleDto::Melodic),
                voice("reimported-high", "Lead", VoiceRoleDto::Melodic),
            ],
        );

        let report = verify_round_trip_model(
            "expected-export",
            &expected,
            "reimported-export",
            &reimported,
        )
        .expect("well-formed projects should compare");

        assert_eq!(
            report.status,
            RoundTripVerificationStatusDto::DifferencesFound
        );
        assert_eq!(report.differences.len(), 1);
        assert_eq!(
            report.differences[0].kind,
            RoundTripDifferenceKindDto::VoicePartition
        );
        assert_eq!(report.differences[0].expected_notes.len(), 2);
        assert_eq!(report.differences[0].reimported_notes.len(), 2);
    }

    #[test]
    fn reports_duplicate_partition_ambiguity_as_inconclusive() {
        let expected = project(
            480,
            960,
            vec![
                note_in_voice("expected-a", "expected-a", 60, 0, 480),
                note_in_voice("expected-b", "expected-b", 60, 0, 480),
            ],
            vec![
                voice("expected-a", "Lead", VoiceRoleDto::Melodic),
                voice("expected-b", "Bass", VoiceRoleDto::Melodic),
            ],
        );
        let reimported = project(
            480,
            960,
            vec![
                note_in_voice("reimported-a", "reimported-a", 60, 0, 480),
                note_in_voice("reimported-b", "reimported-b", 60, 0, 480),
            ],
            vec![
                voice("reimported-a", "Lead", VoiceRoleDto::Melodic),
                voice("reimported-b", "Bass", VoiceRoleDto::Melodic),
            ],
        );

        let report = verify_round_trip_model(
            "expected-export",
            &expected,
            "reimported-export",
            &reimported,
        )
        .expect("well-formed projects should compare");

        assert!(report.note_summary.content_preserved);
        assert_eq!(report.status, RoundTripVerificationStatusDto::Inconclusive);
        assert!(!report.voice_partition.comparable);
        assert_eq!(report.differences.len(), 1);
        assert_eq!(
            report.differences[0].kind,
            RoundTripDifferenceKindDto::AmbiguousDuplicatePartition
        );
    }

    #[test]
    fn reports_crossing_duplicate_end_pairing_as_inconclusive_without_pairing_it() {
        let project = project(
            480,
            960,
            vec![
                note_in_voice("outer", "voice-1", 60, 0, 600),
                note_in_voice("inner", "voice-1", 60, 120, 480),
            ],
            vec![voice("voice-1", "Lead", VoiceRoleDto::Melodic)],
        );

        let report =
            verify_round_trip_model("expected-export", &project, "reimported-export", &project)
                .expect("well-formed project should compare");

        assert_eq!(report.status, RoundTripVerificationStatusDto::Inconclusive);
        let difference = report
            .differences
            .iter()
            .find(|difference| {
                difference.kind == RoundTripDifferenceKindDto::OverlappingDuplicatePairing
            })
            .expect("crossing overlap should be reported");
        assert_eq!(difference.expected_notes.len(), 2);
        assert!(difference.reimported_notes.is_empty());
    }
}
