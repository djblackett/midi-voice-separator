use std::{
    cmp::Ordering,
    collections::{HashMap, HashSet},
};

use serde::{Deserialize, Serialize};

use super::{model::MidiNoteDto, voice_assignment::PERCUSSION_CHANNEL};

const COST_SCALE: u128 = 1_000_000;
const MAX_SAFE_JSON_INTEGER: u128 = 9_007_199_254_740_991;
const VOICE_COMPLEXITY_WEIGHT: u128 = 12_000_000;
const PITCH_MOTION_WEIGHT: u128 = 1_000_000;
const REGISTER_EXPANSION_WEIGHT: u128 = 1_500_000;
const SILENCE_GAP_WEIGHT: u128 = 4_000_000;
const CHANNEL_SWITCH_WEIGHT: u128 = 3_000_000;
const VOICE_CROSSING_WEIGHT: u128 = 2_000_000;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AssignmentMetricId {
    AssignmentModelCost,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EvaluationProfileId {
    GeneralPurpose,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentMetricRefDto {
    pub id: AssignmentMetricId,
    pub version: u32,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationProfileRefDto {
    pub id: EvaluationProfileId,
    pub version: u32,
}

pub const ASSIGNMENT_MODEL_COST_METRIC: AssignmentMetricRefDto = AssignmentMetricRefDto {
    id: AssignmentMetricId::AssignmentModelCost,
    version: 1,
};

pub const GENERAL_PURPOSE_PROFILE: EvaluationProfileRefDto = EvaluationProfileRefDto {
    id: EvaluationProfileId::GeneralPurpose,
    version: 1,
};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentEvaluationRequestDto {
    pub ppq: u16,
    /// Notes already carry their effective assignment. The evaluator
    /// deliberately knows nothing about frontend override maps.
    pub notes: Vec<MidiNoteDto>,
    pub profile: EvaluationProfileRefDto,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AssignmentMetricComponentId {
    VoiceComplexity,
    PitchMotion,
    RegisterExpansion,
    SilenceGap,
    ChannelSwitch,
    VoiceCrossing,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AssignmentMetricUnit {
    Voices,
    Semitones,
    QuarterNotes,
    Transitions,
    Crossings,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentMetricComponentDto {
    pub id: AssignmentMetricComponentId,
    pub raw_value: f64,
    pub unit: AssignmentMetricUnit,
    pub weight: f64,
    pub cost: f64,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AssignmentHardViolationKind {
    InvalidNoteSpan,
    DuplicateNoteId,
    UnassignedMelodicNote,
    MelodicSameVoiceOverlap,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentHardViolationDto {
    pub kind: AssignmentHardViolationKind,
    pub occurrence_count: usize,
    pub affected_note_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentMetricReportDto {
    pub metric: AssignmentMetricRefDto,
    pub profile: EvaluationProfileRefDto,
    pub melodic_note_count: usize,
    pub excluded_percussion_note_count: usize,
    pub melodic_voice_count: usize,
    pub components: Vec<AssignmentMetricComponentDto>,
    pub total_cost: f64,
    pub hard_violations: Vec<AssignmentHardViolationDto>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssignmentMetricError {
    InvalidPpq,
    UnsupportedProfile,
    CostOverflow,
}

#[derive(Debug, Default)]
struct RawComponents {
    voice_count: u128,
    pitch_motion: u128,
    register_expansion: u128,
    silence_gap_micros: u128,
    channel_switches: u128,
    voice_crossings: u128,
}

struct CostComponents {
    voice_complexity: u128,
    pitch_motion: u128,
    register_expansion: u128,
    silence_gap: u128,
    channel_switch: u128,
    voice_crossing: u128,
}

pub fn evaluate_assignment_model_cost(
    request: &AssignmentEvaluationRequestDto,
) -> Result<AssignmentMetricReportDto, AssignmentMetricError> {
    if request.ppq == 0 {
        return Err(AssignmentMetricError::InvalidPpq);
    }
    if request.profile != GENERAL_PURPOSE_PROFILE {
        return Err(AssignmentMetricError::UnsupportedProfile);
    }

    let hard_violations = collect_hard_violations(&request.notes);
    let melodic_notes: Vec<&MidiNoteDto> = request
        .notes
        .iter()
        .filter(|note| note.channel != PERCUSSION_CHANNEL)
        .collect();
    let excluded_percussion_note_count = request.notes.len() - melodic_notes.len();
    let voice_groups = canonical_voice_groups(&melodic_notes);
    let raw = collect_raw_components(&voice_groups, request.ppq);
    let costs = calculate_costs(&raw)?;
    let total_micros = costs
        .voice_complexity
        .checked_add(costs.pitch_motion)
        .and_then(|value| value.checked_add(costs.register_expansion))
        .and_then(|value| value.checked_add(costs.silence_gap))
        .and_then(|value| value.checked_add(costs.channel_switch))
        .and_then(|value| value.checked_add(costs.voice_crossing))
        .ok_or(AssignmentMetricError::CostOverflow)?;
    ensure_json_safe(total_micros)?;

    Ok(AssignmentMetricReportDto {
        metric: ASSIGNMENT_MODEL_COST_METRIC,
        profile: GENERAL_PURPOSE_PROFILE,
        melodic_note_count: melodic_notes.len(),
        excluded_percussion_note_count,
        melodic_voice_count: raw.voice_count as usize,
        components: vec![
            component(
                AssignmentMetricComponentId::VoiceComplexity,
                raw.voice_count,
                AssignmentMetricUnit::Voices,
                VOICE_COMPLEXITY_WEIGHT,
                costs.voice_complexity,
            ),
            component(
                AssignmentMetricComponentId::PitchMotion,
                raw.pitch_motion,
                AssignmentMetricUnit::Semitones,
                PITCH_MOTION_WEIGHT,
                costs.pitch_motion,
            ),
            component(
                AssignmentMetricComponentId::RegisterExpansion,
                raw.register_expansion,
                AssignmentMetricUnit::Semitones,
                REGISTER_EXPANSION_WEIGHT,
                costs.register_expansion,
            ),
            AssignmentMetricComponentDto {
                id: AssignmentMetricComponentId::SilenceGap,
                raw_value: micros_to_number(raw.silence_gap_micros),
                unit: AssignmentMetricUnit::QuarterNotes,
                weight: micros_to_number(SILENCE_GAP_WEIGHT),
                cost: micros_to_number(costs.silence_gap),
            },
            component(
                AssignmentMetricComponentId::ChannelSwitch,
                raw.channel_switches,
                AssignmentMetricUnit::Transitions,
                CHANNEL_SWITCH_WEIGHT,
                costs.channel_switch,
            ),
            component(
                AssignmentMetricComponentId::VoiceCrossing,
                raw.voice_crossings,
                AssignmentMetricUnit::Crossings,
                VOICE_CROSSING_WEIGHT,
                costs.voice_crossing,
            ),
        ],
        total_cost: micros_to_number(total_micros),
        hard_violations,
    })
}

fn canonical_voice_groups<'a>(notes: &[&'a MidiNoteDto]) -> Vec<Vec<&'a MidiNoteDto>> {
    let mut by_voice: HashMap<&str, Vec<&MidiNoteDto>> = HashMap::new();
    for note in notes.iter().filter(|note| !note.voice_id.trim().is_empty()) {
        by_voice
            .entry(note.voice_id.as_str())
            .or_default()
            .push(note);
    }
    let mut groups: Vec<Vec<&MidiNoteDto>> = by_voice.into_values().collect();
    for group in &mut groups {
        group.sort_by(|left, right| compare_notes(left, right));
    }
    groups.sort_by(|left, right| compare_note_sequences(left, right));
    groups
}

fn compare_notes(left: &MidiNoteDto, right: &MidiNoteDto) -> Ordering {
    left.start_tick
        .cmp(&right.start_tick)
        .then(left.end_tick.cmp(&right.end_tick))
        .then(left.pitch.cmp(&right.pitch))
        .then(left.channel.cmp(&right.channel))
        .then(left.velocity.cmp(&right.velocity))
        .then(left.source_track_index.cmp(&right.source_track_index))
        .then(left.id.cmp(&right.id))
}

fn compare_note_sequences(left: &[&MidiNoteDto], right: &[&MidiNoteDto]) -> Ordering {
    for (left_note, right_note) in left.iter().zip(right.iter()) {
        let ordering = compare_notes(left_note, right_note);
        if ordering != Ordering::Equal {
            return ordering;
        }
    }
    left.len().cmp(&right.len())
}

fn collect_raw_components(groups: &[Vec<&MidiNoteDto>], ppq: u16) -> RawComponents {
    let mut raw = RawComponents {
        voice_count: groups.len() as u128,
        ..RawComponents::default()
    };
    for (group_index, group) in groups.iter().enumerate() {
        let mut lowest_pitch = group.first().map_or(0, |note| note.pitch);
        let mut highest_pitch = lowest_pitch;
        for (note_index, pair) in group.windows(2).enumerate() {
            let previous = pair[0];
            let note = pair[1];
            raw.pitch_motion += u128::from(previous.pitch.abs_diff(note.pitch));
            if note_index + 1 >= 2 {
                raw.register_expansion += u128::from(
                    note.pitch
                        .saturating_sub(highest_pitch)
                        .max(lowest_pitch.saturating_sub(note.pitch)),
                );
            }
            let gap = note.start_tick.saturating_sub(previous.end_tick);
            raw.silence_gap_micros += normalized_gap_micros(gap, ppq);
            raw.channel_switches += u128::from(previous.channel != note.channel);
            raw.voice_crossings += crossing_count(groups, group_index, previous, note) as u128;
            lowest_pitch = lowest_pitch.min(note.pitch);
            highest_pitch = highest_pitch.max(note.pitch);
        }
    }
    raw
}

fn normalized_gap_micros(gap_ticks: u64, ppq: u16) -> u128 {
    let capped_gap = gap_ticks.min(u64::from(ppq));
    let numerator = u128::from(capped_gap) * COST_SCALE;
    let denominator = u128::from(ppq);
    (numerator + denominator / 2) / denominator
}

fn crossing_count(
    groups: &[Vec<&MidiNoteDto>],
    current_group_index: usize,
    previous: &MidiNoteDto,
    note: &MidiNoteDto,
) -> usize {
    let low = previous.pitch.min(note.pitch);
    let high = previous.pitch.max(note.pitch);
    groups
        .iter()
        .enumerate()
        .filter(|(index, _)| *index != current_group_index)
        .flat_map(|(_, group)| group.iter())
        .filter(|other| {
            other.start_tick <= note.start_tick
                && other.end_tick > note.start_tick
                && other.pitch > low
                && other.pitch < high
        })
        .count()
}

fn calculate_costs(raw: &RawComponents) -> Result<CostComponents, AssignmentMetricError> {
    let multiply = |value: u128, weight: u128| {
        value
            .checked_mul(weight)
            .ok_or(AssignmentMetricError::CostOverflow)
    };
    let costs = CostComponents {
        voice_complexity: multiply(raw.voice_count, VOICE_COMPLEXITY_WEIGHT)?,
        pitch_motion: multiply(raw.pitch_motion, PITCH_MOTION_WEIGHT)?,
        register_expansion: multiply(raw.register_expansion, REGISTER_EXPANSION_WEIGHT)?,
        silence_gap: multiply(raw.silence_gap_micros, SILENCE_GAP_WEIGHT)? / COST_SCALE,
        channel_switch: multiply(raw.channel_switches, CHANNEL_SWITCH_WEIGHT)?,
        voice_crossing: multiply(raw.voice_crossings, VOICE_CROSSING_WEIGHT)?,
    };
    for value in [
        costs.voice_complexity,
        costs.pitch_motion,
        costs.register_expansion,
        costs.silence_gap,
        costs.channel_switch,
        costs.voice_crossing,
    ] {
        ensure_json_safe(value)?;
    }
    Ok(costs)
}

fn ensure_json_safe(value: u128) -> Result<(), AssignmentMetricError> {
    if value > MAX_SAFE_JSON_INTEGER {
        Err(AssignmentMetricError::CostOverflow)
    } else {
        Ok(())
    }
}

fn component(
    id: AssignmentMetricComponentId,
    raw_value: u128,
    unit: AssignmentMetricUnit,
    weight_micros: u128,
    cost_micros: u128,
) -> AssignmentMetricComponentDto {
    AssignmentMetricComponentDto {
        id,
        raw_value: raw_value as f64,
        unit,
        weight: micros_to_number(weight_micros),
        cost: micros_to_number(cost_micros),
    }
}

fn micros_to_number(value: u128) -> f64 {
    value as f64 / COST_SCALE as f64
}

fn collect_hard_violations(notes: &[MidiNoteDto]) -> Vec<AssignmentHardViolationDto> {
    let mut violations = Vec::new();
    let invalid_ids: Vec<String> = notes
        .iter()
        .filter(|note| note.end_tick < note.start_tick)
        .map(|note| note.id.clone())
        .collect();
    push_violation(
        &mut violations,
        AssignmentHardViolationKind::InvalidNoteSpan,
        invalid_ids.len(),
        invalid_ids,
    );

    let mut id_counts: HashMap<&str, usize> = HashMap::new();
    for note in notes {
        *id_counts.entry(note.id.as_str()).or_default() += 1;
    }
    let duplicate_ids: Vec<String> = id_counts
        .iter()
        .filter(|(_, count)| **count > 1)
        .map(|(id, _)| (*id).to_string())
        .collect();
    let duplicate_occurrences = id_counts
        .values()
        .map(|count| count.saturating_sub(1))
        .sum();
    push_violation(
        &mut violations,
        AssignmentHardViolationKind::DuplicateNoteId,
        duplicate_occurrences,
        duplicate_ids,
    );

    let unassigned_ids: Vec<String> = notes
        .iter()
        .filter(|note| note.channel != PERCUSSION_CHANNEL && note.voice_id.trim().is_empty())
        .map(|note| note.id.clone())
        .collect();
    push_violation(
        &mut violations,
        AssignmentHardViolationKind::UnassignedMelodicNote,
        unassigned_ids.len(),
        unassigned_ids,
    );

    let melodic: Vec<&MidiNoteDto> = notes
        .iter()
        .filter(|note| note.channel != PERCUSSION_CHANNEL && !note.voice_id.trim().is_empty())
        .collect();
    let groups = canonical_voice_groups(&melodic);
    let mut overlap_count = 0;
    let mut overlap_ids = HashSet::new();
    for group in groups {
        for left_index in 0..group.len() {
            for right in group.iter().skip(left_index + 1) {
                let left = group[left_index];
                if right.start_tick >= left.end_tick {
                    break;
                }
                if left.start_tick < right.end_tick && right.start_tick < left.end_tick {
                    overlap_count += 1;
                    overlap_ids.insert(left.id.clone());
                    overlap_ids.insert(right.id.clone());
                }
            }
        }
    }
    push_violation(
        &mut violations,
        AssignmentHardViolationKind::MelodicSameVoiceOverlap,
        overlap_count,
        overlap_ids.into_iter().collect(),
    );
    violations
}

fn push_violation(
    violations: &mut Vec<AssignmentHardViolationDto>,
    kind: AssignmentHardViolationKind,
    occurrence_count: usize,
    mut affected_note_ids: Vec<String>,
) {
    if occurrence_count == 0 {
        return;
    }
    affected_note_ids.sort();
    affected_note_ids.dedup();
    violations.push(AssignmentHardViolationDto {
        kind,
        occurrence_count,
        affected_note_ids,
    });
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use super::*;
    use crate::midi::{model::AssignmentReason, parser::parse_midi_project};

    fn note(id: &str, voice_id: &str, pitch: u8, start: u64, end: u64) -> MidiNoteDto {
        MidiNoteDto {
            id: id.to_string(),
            voice_id: voice_id.to_string(),
            source_track_index: 0,
            channel: 0,
            pitch,
            velocity: 100,
            start_tick: start,
            end_tick: end,
            duration_ticks: end.saturating_sub(start),
            assignment_confidence: 1.0,
            assignment_reason: AssignmentReason::Imported,
        }
    }

    fn request(notes: Vec<MidiNoteDto>) -> AssignmentEvaluationRequestDto {
        AssignmentEvaluationRequestDto {
            ppq: 480,
            notes,
            profile: GENERAL_PURPOSE_PROFILE,
        }
    }

    #[test]
    fn reports_the_frozen_metric_and_profile_identity() {
        let report =
            evaluate_assignment_model_cost(&request(vec![note("a", "voice-1", 60, 0, 480)]))
                .expect("evaluation should succeed");
        assert_eq!(report.metric, ASSIGNMENT_MODEL_COST_METRIC);
        assert_eq!(report.profile, GENERAL_PURPOSE_PROFILE);
        assert_eq!(report.components.len(), 6);
    }

    #[test]
    fn charges_a_positive_cost_for_the_first_note_in_each_voice() {
        let report = evaluate_assignment_model_cost(&request(vec![
            note("a", "voice-1", 60, 0, 480),
            note("b", "voice-2", 72, 0, 480),
        ]))
        .expect("evaluation should succeed");
        assert_eq!(report.melodic_voice_count, 2);
        assert_eq!(report.components[0].cost, 24.0);
        assert_eq!(report.total_cost, 24.0);
    }

    #[test]
    fn component_costs_sum_to_the_total() {
        let report = evaluate_assignment_model_cost(&request(vec![
            note("a", "voice-1", 60, 0, 240),
            note("b", "voice-1", 64, 480, 720),
            note("c", "voice-1", 72, 960, 1200),
        ]))
        .expect("evaluation should succeed");
        let sum: f64 = report
            .components
            .iter()
            .map(|component| component.cost)
            .sum();
        assert_eq!(sum, report.total_cost);
    }

    #[test]
    fn result_is_note_order_invariant() {
        let notes = vec![
            note("a", "voice-1", 60, 0, 240),
            note("b", "voice-2", 72, 0, 240),
            note("c", "voice-1", 64, 480, 720),
            note("d", "voice-2", 74, 480, 720),
        ];
        let expected = evaluate_assignment_model_cost(&request(notes.clone())).unwrap();
        let mut reversed = notes;
        reversed.reverse();
        assert_eq!(
            evaluate_assignment_model_cost(&request(reversed)).unwrap(),
            expected
        );
    }

    #[test]
    fn result_is_voice_id_invariant() {
        let notes = vec![
            note("a", "voice-1", 60, 0, 240),
            note("b", "voice-2", 72, 0, 240),
            note("c", "voice-1", 64, 480, 720),
            note("d", "voice-2", 74, 480, 720),
        ];
        let expected = evaluate_assignment_model_cost(&request(notes.clone())).unwrap();
        let renamed = notes
            .into_iter()
            .map(|mut note| {
                note.voice_id = match note.voice_id.as_str() {
                    "voice-1" => "renamed-z",
                    _ => "renamed-a",
                }
                .to_string();
                note
            })
            .collect();
        assert_eq!(
            evaluate_assignment_model_cost(&request(renamed)).unwrap(),
            expected
        );
    }

    #[test]
    fn equivalent_ppq_timing_produces_the_same_report() {
        let base = request(vec![
            note("a", "voice-1", 60, 0, 240),
            note("b", "voice-1", 64, 360, 600),
        ]);
        let mut scaled = base.clone();
        scaled.ppq = 960;
        for note in &mut scaled.notes {
            note.start_tick *= 2;
            note.end_tick *= 2;
            note.duration_ticks *= 2;
        }
        assert_eq!(
            evaluate_assignment_model_cost(&base).unwrap(),
            evaluate_assignment_model_cost(&scaled).unwrap()
        );
    }

    #[test]
    fn excludes_percussion_by_channel_even_when_voice_ids_are_misleading() {
        let mut drum = note("drum", "voice-1", 36, 0, 480);
        drum.channel = PERCUSSION_CHANNEL;
        let melodic = note("lead", "percussion", 72, 0, 480);
        let report = evaluate_assignment_model_cost(&request(vec![drum, melodic])).unwrap();
        assert_eq!(report.excluded_percussion_note_count, 1);
        assert_eq!(report.melodic_note_count, 1);
        assert_eq!(report.melodic_voice_count, 1);
        assert_eq!(report.total_cost, 12.0);
    }

    #[test]
    fn reports_same_voice_overlap_as_a_hard_violation() {
        let report = evaluate_assignment_model_cost(&request(vec![
            note("a", "voice-1", 60, 0, 480),
            note("b", "voice-1", 64, 240, 720),
        ]))
        .unwrap();
        assert_eq!(
            report.hard_violations,
            vec![AssignmentHardViolationDto {
                kind: AssignmentHardViolationKind::MelodicSameVoiceOverlap,
                occurrence_count: 1,
                affected_note_ids: vec!["a".to_string(), "b".to_string()],
            }]
        );
    }

    #[test]
    fn reports_structural_hard_violations_deterministically() {
        let mut invalid = note("bad", "", 60, 480, 240);
        invalid.duration_ticks = 0;
        let duplicate = note("bad", "voice-1", 64, 720, 960);
        let report = evaluate_assignment_model_cost(&request(vec![duplicate, invalid])).unwrap();
        assert_eq!(
            report
                .hard_violations
                .iter()
                .map(|item| item.kind)
                .collect::<Vec<_>>(),
            vec![
                AssignmentHardViolationKind::InvalidNoteSpan,
                AssignmentHardViolationKind::DuplicateNoteId,
                AssignmentHardViolationKind::UnassignedMelodicNote,
            ]
        );
    }

    #[test]
    fn empty_and_percussion_only_inputs_have_zero_cost() {
        let empty = evaluate_assignment_model_cost(&request(Vec::new())).unwrap();
        assert_eq!(empty.total_cost, 0.0);
        let mut drum = note("drum", "percussion", 36, 0, 0);
        drum.channel = PERCUSSION_CHANNEL;
        let percussion = evaluate_assignment_model_cost(&request(vec![drum])).unwrap();
        assert_eq!(percussion.total_cost, 0.0);
        assert!(percussion.hard_violations.is_empty());
    }

    #[test]
    fn rejects_zero_ppq_and_unknown_profile_versions() {
        let mut invalid_ppq = request(Vec::new());
        invalid_ppq.ppq = 0;
        assert_eq!(
            evaluate_assignment_model_cost(&invalid_ppq),
            Err(AssignmentMetricError::InvalidPpq)
        );
        let mut unknown_profile = request(Vec::new());
        unknown_profile.profile.version = 2;
        assert_eq!(
            evaluate_assignment_model_cost(&unknown_profile),
            Err(AssignmentMetricError::UnsupportedProfile)
        );
    }

    fn fixture_request(name: &str) -> AssignmentEvaluationRequestDto {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("fixtures")
            .join(name);
        let bytes = fs::read(&path).expect("fixture should be readable");
        let project = parse_midi_project(&path, &bytes).expect("fixture should parse");
        AssignmentEvaluationRequestDto {
            ppq: project.ppq,
            notes: project.notes,
            profile: GENERAL_PURPOSE_PROFILE,
        }
    }

    #[test]
    fn dense_real_fixtures_are_deterministic_and_invariant() {
        for fixture in [
            "boss-battle-6-combined.mid",
            "boss-battle-6-separate-tracks.mid",
        ] {
            let request = fixture_request(fixture);
            let expected = evaluate_assignment_model_cost(&request).unwrap();
            assert!(expected.total_cost.is_finite());
            assert!(expected.total_cost >= 0.0);

            let mut reversed = request.clone();
            reversed.notes.reverse();
            assert_eq!(evaluate_assignment_model_cost(&reversed).unwrap(), expected);

            let mut renamed = request.clone();
            for note in &mut renamed.notes {
                note.voice_id = format!("renamed-{}", note.voice_id);
            }
            assert_eq!(evaluate_assignment_model_cost(&renamed).unwrap(), expected);
        }
    }
}
