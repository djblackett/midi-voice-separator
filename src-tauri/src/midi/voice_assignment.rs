use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use super::model::{
    AssignmentMode, AssignmentReason, MidiNoteDto, MidiVoiceDto, SeparationStrategy,
    SeparationSummaryDto,
};

/// Tuning constants for the assignment cost model that don't vary by
/// `SeparationStrategy`. These are deliberately simple (no learned
/// weights) and exist to make the heuristic explainable rather than
/// musically optimal.
const GAP_NORMALIZATION_TICKS: f32 = 960.0;
const CONFIDENCE_SCALE: f32 = 6.0;
const LOW_CONFIDENCE_THRESHOLD: f32 = 0.5;
/// A voice's range is a single point until it has at least this many
/// notes, which would make the register-distance term below identical to
/// the plain last-pitch distance and double-count it. Below this count,
/// there isn't really an "established range" yet, so the term is skipped
/// entirely rather than scored against a degenerate one-note range.
const REGISTER_ESTABLISHED_NOTE_COUNT: usize = 2;

/// The three weights `score_candidates` combines into a single cost.
/// Bundled per `SeparationStrategy` instead of being fixed constants, so
/// "Re-run separation" can be tried with a few different weightings on
/// the same file rather than only ever scoring against one fixed
/// weighting.
#[derive(Debug, Clone, Copy)]
struct CostWeights {
    gap_weight: f32,
    channel_continuity_bonus: f32,
    /// Weight applied to how far a note falls outside a voice's
    /// established pitch range (its lowest/highest pitch so far), on top
    /// of the plain distance from the voice's *last* note. Without this,
    /// a voice is scored only against its most recent note, so a long
    /// melodic line can drift across the entire pitch range one cheap
    /// small step at a time — each individual step looks like a good
    /// match, but the voice ends up spanning several octaves. This term
    /// makes reusing a voice progressively more expensive the further a
    /// note falls beyond the range it's already established, so an
    /// already-correct, register-matching voice is preferred over one
    /// that merely happens to have a nearby last note.
    register_drift_weight: f32,
}

impl SeparationStrategy {
    fn cost_weights(self) -> CostWeights {
        match self {
            // Today's defaults. Every existing test's expectations were
            // written against these numbers.
            SeparationStrategy::Balanced => CostWeights {
                gap_weight: 4.0,
                channel_continuity_bonus: 3.0,
                register_drift_weight: 1.5,
            },
            // For files where each instrument already lives on a stable
            // MIDI channel: channel match dominates over a moderate
            // pitch jump.
            SeparationStrategy::ChannelPriority => CostWeights {
                gap_weight: 4.0,
                channel_continuity_bonus: 12.0,
                register_drift_weight: 1.5,
            },
            // For files where channel is a weak signal (e.g. most of the
            // piece crammed onto one MIDI channel): keeping a voice's
            // pitch range tight matters far more than channel
            // continuity.
            SeparationStrategy::RegisterPriority => CostWeights {
                gap_weight: 4.0,
                channel_continuity_bonus: 1.0,
                register_drift_weight: 4.0,
            },
            // Channel match wins whenever a same-channel compatible
            // voice exists at all; pitch only decides ties, picks among
            // multiple same-channel candidates, or matters when no
            // same-channel voice is available yet. Effectively "one
            // voice per channel" without a second algorithm.
            SeparationStrategy::StrictChannel => CostWeights {
                gap_weight: 4.0,
                channel_continuity_bonus: 1000.0,
                register_drift_weight: 0.0,
            },
        }
    }
}

#[derive(Debug, Clone)]
struct VoiceState {
    id: String,
    last_end_tick: u64,
    last_pitch: u8,
    last_channel: u8,
    note_count: usize,
    lowest_pitch: u8,
    highest_pitch: u8,
}

#[derive(Debug, Clone, Copy)]
struct Candidate {
    index: usize,
    cost: f32,
    channel_match: bool,
}

pub fn assign_heuristic_voices(notes: &mut [MidiNoteDto]) -> Vec<MidiVoiceDto> {
    assign_heuristic_voices_with_locks(notes, &HashMap::new(), None, SeparationStrategy::Balanced)
}

/// Dispatches to whichever assignment algorithm `mode` selects. `strategy`
/// (the cost weighting) applies to either one.
pub fn assign_voices_with_locks(
    notes: &mut [MidiNoteDto],
    locked: &HashMap<String, String>,
    max_voice_count: Option<usize>,
    strategy: SeparationStrategy,
    mode: AssignmentMode,
) -> Vec<MidiVoiceDto> {
    match mode {
        AssignmentMode::Greedy => {
            assign_heuristic_voices_with_locks(notes, locked, max_voice_count, strategy)
        }
        AssignmentMode::Global => {
            assign_windowed_voices_with_locks(notes, locked, max_voice_count, strategy)
        }
    }
}

/// Same heuristic as `assign_heuristic_voices`, except any note present in
/// `locked` (note id -> voice id) is pinned to that voice instead of being
/// scored by the cost model. Locked notes still update their voice's
/// running pitch/channel/end-tick state, so unlocked neighbors are pulled
/// toward a manually corrected voice rather than ignoring it.
///
/// `max_voice_count`, if set, caps how many voices the unlocked path may
/// open. Once at the cap, a note with no non-overlapping ("compatible")
/// voice is forced into the lowest-cost existing voice anyway rather than
/// opening a new one, even though that means the voice now has two notes
/// overlapping in time. This is a deliberate trade-off of enabling the cap
/// at all: forced-overlap assignments get confidence `0.0` (reason
/// `VoiceCapReached`) so they always surface in review mode. Locked notes
/// are exempt from the cap, since they're a hard user constraint, not a
/// heuristic guess.
///
/// `strategy` selects which `CostWeights` preset scores unlocked notes;
/// locked notes are unaffected by it, since they skip scoring entirely.
pub fn assign_heuristic_voices_with_locks(
    notes: &mut [MidiNoteDto],
    locked: &HashMap<String, String>,
    max_voice_count: Option<usize>,
    strategy: SeparationStrategy,
) -> Vec<MidiVoiceDto> {
    let weights = strategy.cost_weights();
    let reserved_voice_ids: HashSet<&str> = locked.values().map(String::as_str).collect();
    let mut voices: Vec<VoiceState> = Vec::new();
    let mut voice_index_by_id: HashMap<String, usize> = HashMap::new();

    for note in notes.iter_mut() {
        if let Some(locked_voice_id) = locked.get(&note.id) {
            let voice_index = *voice_index_by_id
                .entry(locked_voice_id.clone())
                .or_insert_with(|| {
                    let next_index = voices.len();
                    voices.push(VoiceState {
                        id: locked_voice_id.clone(),
                        last_end_tick: 0,
                        last_pitch: note.pitch,
                        last_channel: note.channel,
                        note_count: 0,
                        lowest_pitch: note.pitch,
                        highest_pitch: note.pitch,
                    });
                    next_index
                });

            let voice = &mut voices[voice_index];
            note.voice_id.clone_from(&voice.id);
            note.assignment_confidence = 1.0;
            note.assignment_reason = AssignmentReason::UserLocked;
            voice.last_end_tick = note.end_tick;
            voice.last_pitch = note.pitch;
            voice.last_channel = note.channel;
            voice.note_count += 1;
            voice.lowest_pitch = voice.lowest_pitch.min(note.pitch);
            voice.highest_pitch = voice.highest_pitch.max(note.pitch);
            continue;
        }

        let candidates = compatible_candidates(&voices, note, &weights);
        let (voice_index, confidence, reason) = match best_and_second_cost(&candidates) {
            Some((best, second_cost)) => {
                let confidence = match second_cost {
                    Some(second_cost) => {
                        ((second_cost - best.cost) / CONFIDENCE_SCALE).clamp(0.0, 1.0)
                    }
                    None => 1.0,
                };
                let reason = if best.channel_match {
                    AssignmentReason::ChannelContinuity
                } else {
                    AssignmentReason::ClosestPitch
                };
                (best.index, confidence, reason)
            }
            None if !voices.is_empty()
                && max_voice_count.is_some_and(|max| voices.len() >= max) =>
            {
                // At the cap with no compatible voice: force the
                // lowest-cost existing voice anyway rather than exceed the
                // cap. `require_compatible: false` scores every voice
                // regardless of overlap.
                let forced_candidates = score_candidates(&voices, note, false, &weights);
                let best = forced_candidates
                    .iter()
                    .min_by(|left, right| {
                        left.cost
                            .partial_cmp(&right.cost)
                            .unwrap_or(std::cmp::Ordering::Equal)
                            .then(left.index.cmp(&right.index))
                    })
                    .expect("voices is non-empty when at the voice cap");
                (best.index, 0.0, AssignmentReason::VoiceCapReached)
            }
            None => {
                let new_id = allocate_new_voice_id(&voice_index_by_id, &reserved_voice_ids);
                let next_index = voices.len();
                voice_index_by_id.insert(new_id.clone(), next_index);
                voices.push(VoiceState {
                    id: new_id,
                    last_end_tick: 0,
                    last_pitch: note.pitch,
                    last_channel: note.channel,
                    note_count: 0,
                    lowest_pitch: note.pitch,
                    highest_pitch: note.pitch,
                });
                (next_index, 1.0, AssignmentReason::NewVoiceNoFit)
            }
        };

        let voice = &mut voices[voice_index];
        note.voice_id.clone_from(&voice.id);
        note.assignment_confidence = confidence;
        note.assignment_reason = reason;
        // A forced-overlap assignment may end earlier than the voice's
        // true latest note (it was never compatible to begin with), so
        // only extend `last_end_tick`, never roll it back.
        voice.last_end_tick = if reason == AssignmentReason::VoiceCapReached {
            voice.last_end_tick.max(note.end_tick)
        } else {
            note.end_tick
        };
        voice.last_pitch = note.pitch;
        voice.last_channel = note.channel;
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

/// How many unlocked notes are buffered before the window is exhaustively
/// re-optimized. Larger catches divergences (like the demonstrated case
/// where an early channel-continuity pick forced a much worse split several
/// notes later) that span a wider gap, at the cost of `candidates ^ window`
/// search branches per flush -- kept modest since this runs once per
/// `LOOKAHEAD_WINDOW` notes across a whole file, not once per note.
const LOOKAHEAD_WINDOW: usize = 6;
/// How many of the cheapest compatible voices are actually explored per
/// note during the window search (plus "open a new voice" when budget
/// allows). Bounds the branching factor independent of how many voices
/// already exist in a long piece -- final confidence/reason reporting
/// still checks every compatible voice, not just this shortlist, so
/// pruning here only affects the search, never the reported numbers.
const LOOKAHEAD_CANDIDATES_PER_NOTE: usize = 3;

#[derive(Clone)]
struct WindowSearchState {
    /// `voices[0..existing_count]` are clones of the real, already-committed
    /// voices; anything beyond that was opened during this search branch.
    voices: Vec<VoiceState>,
    cost: f32,
    /// One entry per pending note processed so far, indexing into `voices`.
    labels: Vec<usize>,
}

/// Same cost model and compatibility rules as `assign_heuristic_voices_with_locks`,
/// but instead of committing each unlocked note to its single cheapest
/// compatible voice immediately, buffers up to `LOOKAHEAD_WINDOW` unlocked
/// notes and exhaustively searches for the true minimum-cost grouping
/// across that whole window before committing any of them. A locked note
/// flushes whatever is currently pending first (locks can't be reordered
/// around), then is pinned exactly as in the greedy path.
///
/// This directly addresses greedy's known failure mode: an early note can
/// have a locally-cheapest voice that, a few notes later, turns out to have
/// foreclosed a much better overall split (e.g. a clean low/high
/// pitch-register grouping) that greedy could never see coming because it
/// never revisits a commitment. It is not whole-piece-optimal -- only
/// exhaustive within each window -- so a divergence spanning more than
/// `LOOKAHEAD_WINDOW` notes can still slip through a window boundary.
pub fn assign_windowed_voices_with_locks(
    notes: &mut [MidiNoteDto],
    locked: &HashMap<String, String>,
    max_voice_count: Option<usize>,
    strategy: SeparationStrategy,
) -> Vec<MidiVoiceDto> {
    let weights = strategy.cost_weights();
    let reserved_voice_ids: HashSet<&str> = locked.values().map(String::as_str).collect();
    let mut voices: Vec<VoiceState> = Vec::new();
    let mut voice_index_by_id: HashMap<String, usize> = HashMap::new();
    let mut pending: Vec<usize> = Vec::new();

    for index in 0..notes.len() {
        if locked.contains_key(&notes[index].id) {
            flush_pending_window(
                notes,
                &mut pending,
                &mut voices,
                &mut voice_index_by_id,
                &reserved_voice_ids,
                max_voice_count,
                &weights,
            );
            commit_locked_note(notes, index, locked, &mut voices, &mut voice_index_by_id);
            continue;
        }

        pending.push(index);
        if pending.len() >= LOOKAHEAD_WINDOW {
            flush_pending_window(
                notes,
                &mut pending,
                &mut voices,
                &mut voice_index_by_id,
                &reserved_voice_ids,
                max_voice_count,
                &weights,
            );
        }
    }
    flush_pending_window(
        notes,
        &mut pending,
        &mut voices,
        &mut voice_index_by_id,
        &reserved_voice_ids,
        max_voice_count,
        &weights,
    );

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

/// Pins a locked note to its reserved voice, identical to the inline
/// handling in `assign_heuristic_voices_with_locks`.
fn commit_locked_note(
    notes: &mut [MidiNoteDto],
    index: usize,
    locked: &HashMap<String, String>,
    voices: &mut Vec<VoiceState>,
    voice_index_by_id: &mut HashMap<String, usize>,
) {
    let note = &mut notes[index];
    let locked_voice_id = locked
        .get(&note.id)
        .expect("caller already checked this note is locked");
    let voice_index = *voice_index_by_id
        .entry(locked_voice_id.clone())
        .or_insert_with(|| {
            let next_index = voices.len();
            voices.push(VoiceState {
                id: locked_voice_id.clone(),
                last_end_tick: 0,
                last_pitch: note.pitch,
                last_channel: note.channel,
                note_count: 0,
                lowest_pitch: note.pitch,
                highest_pitch: note.pitch,
            });
            next_index
        });

    let voice = &mut voices[voice_index];
    note.voice_id.clone_from(&voice.id);
    note.assignment_confidence = 1.0;
    note.assignment_reason = AssignmentReason::UserLocked;
    voice.last_end_tick = note.end_tick;
    voice.last_pitch = note.pitch;
    voice.last_channel = note.channel;
    voice.note_count += 1;
    voice.lowest_pitch = voice.lowest_pitch.min(note.pitch);
    voice.highest_pitch = voice.highest_pitch.max(note.pitch);
}

/// The classic "minimum meeting rooms" greedy algorithm, generalized to
/// treat each already-committed voice as a "room" that only becomes free
/// at its `last_end_tick` rather than at time zero: returns the fewest new
/// voices `pending` can possibly need, given `voices` may already free up
/// partway through the window and become reusable again. This is a hard
/// lower bound, not a preference -- provably optimal for interval
/// scheduling, so it is safe to forbid the search from opening more than
/// this many new voices.
fn structural_new_voices_needed(
    voices: &[VoiceState],
    notes: &[MidiNoteDto],
    pending: &[usize],
) -> usize {
    let mut free_at: std::collections::BinaryHeap<std::cmp::Reverse<u64>> = voices
        .iter()
        .map(|voice| std::cmp::Reverse(voice.last_end_tick))
        .collect();
    let mut new_voices = 0usize;

    for &index in pending {
        let note = &notes[index];
        let can_reuse = free_at
            .peek()
            .is_some_and(|std::cmp::Reverse(end)| *end <= note.start_tick);
        if can_reuse {
            free_at.pop();
        } else {
            new_voices += 1;
        }
        free_at.push(std::cmp::Reverse(note.end_tick));
    }

    new_voices
}

/// Solves and commits whatever notes are currently buffered in `pending`,
/// leaving it empty. No-op if `pending` is empty (e.g. a locked note
/// immediately following another locked note).
#[allow(clippy::too_many_arguments)]
fn flush_pending_window(
    notes: &mut [MidiNoteDto],
    pending: &mut Vec<usize>,
    voices: &mut Vec<VoiceState>,
    voice_index_by_id: &mut HashMap<String, usize>,
    reserved_voice_ids: &HashSet<&str>,
    max_voice_count: Option<usize>,
    weights: &CostWeights,
) {
    if pending.is_empty() {
        return;
    }

    let existing_count = voices.len();
    // The search scores opening a new voice at a flat 0 (matching greedy's
    // convention of never scoring a `NewVoiceNoFit` assignment at all), so
    // an *unconstrained* search would always prefer opening a new voice
    // over any reuse with a positive cost -- degenerating into "give every
    // note its own voice." Greedy never has this problem because it only
    // ever opens a new voice when no compatible one exists, i.e. it never
    // opens more voices than the true structural minimum. Capping the
    // search at that same structural minimum (falling back to the user's
    // `max_voice_count` if that's even tighter) restores the real
    // reuse-vs-new trade-off instead of letting free-new-voice cost win by
    // default.
    let structural_new_voices = structural_new_voices_needed(voices, notes, pending);
    let mut max_new_voices = match max_voice_count {
        Some(max) => max
            .saturating_sub(existing_count)
            .min(structural_new_voices),
        None => structural_new_voices,
    };
    if existing_count == 0 {
        // Mirrors greedy's `voice_cap_still_allows_the_very_first_voice`:
        // even a cap of 0 must allow opening the very first voice, since
        // leaving a note completely unassigned isn't a valid outcome.
        max_new_voices = max_new_voices.max(1);
    }

    let initial_state = WindowSearchState {
        voices: voices.clone(),
        cost: 0.0,
        labels: Vec::with_capacity(pending.len()),
    };
    let mut best: Option<WindowSearchState> = None;
    search_window(
        notes,
        pending,
        0,
        initial_state,
        existing_count,
        max_new_voices,
        weights,
        &mut best,
    );
    let best =
        best.expect("search_window always finds at least one assignment for non-empty pending");

    commit_window_result(
        notes,
        pending,
        &best.labels,
        existing_count,
        voices,
        voice_index_by_id,
        reserved_voice_ids,
        weights,
    );

    pending.clear();
}

/// Exhaustively searches (with branch-and-bound pruning on `best.cost`) for
/// the minimum-cost way to assign `pending[depth..]` to voices, where a
/// voice is either one of the first `existing_count` entries of
/// `state.voices` (already-committed, real) or one opened earlier within
/// this same search branch. Candidate voices per note are capped at
/// `LOOKAHEAD_CANDIDATES_PER_NOTE` (plus "open new") to keep branching
/// bounded regardless of how many voices exist in a long piece; if no
/// voice is compatible and no new-voice budget remains, falls back to
/// forcing the single cheapest voice overall, mirroring greedy's
/// at-the-cap behavior.
#[allow(clippy::too_many_arguments)]
fn search_window(
    notes: &[MidiNoteDto],
    pending: &[usize],
    depth: usize,
    state: WindowSearchState,
    existing_count: usize,
    max_new_voices: usize,
    weights: &CostWeights,
    best: &mut Option<WindowSearchState>,
) {
    if depth == pending.len() {
        if best.as_ref().is_none_or(|found| state.cost < found.cost) {
            *best = Some(state);
        }
        return;
    }
    if let Some(found) = best {
        if state.cost >= found.cost {
            return;
        }
    }

    let note = &notes[pending[depth]];
    let new_voice_count = state.voices.len() - existing_count;
    let can_open_new = new_voice_count < max_new_voices;

    let mut scored: Vec<(usize, f32, bool)> = state
        .voices
        .iter()
        .enumerate()
        .map(|(index, voice)| {
            let compatible = voice.last_end_tick <= note.start_tick;
            let cost = score_candidates(std::slice::from_ref(voice), note, false, weights)[0].cost;
            (index, cost, compatible)
        })
        .collect();

    let mut branch_targets: Vec<(usize, f32, bool)> = Vec::new();
    let has_compatible = scored.iter().any(|(_, _, compatible)| *compatible);

    if has_compatible {
        scored.retain(|(_, _, compatible)| *compatible);
        scored.sort_by(|left, right| left.1.partial_cmp(&right.1).unwrap_or(Ordering::Equal));
        scored.truncate(LOOKAHEAD_CANDIDATES_PER_NOTE);
        for (index, cost, _) in scored {
            branch_targets.push((index, cost, false));
        }
        if can_open_new {
            branch_targets.push((state.voices.len(), 0.0, true));
        }
    } else if can_open_new {
        branch_targets.push((state.voices.len(), 0.0, true));
    } else {
        scored.sort_by(|left, right| left.1.partial_cmp(&right.1).unwrap_or(Ordering::Equal));
        if let Some(&(index, cost, _)) = scored.first() {
            branch_targets.push((index, cost, false));
        }
    }

    for (target_index, cost, is_new) in branch_targets {
        let mut next_state = state.clone();
        let real_index = if is_new {
            next_state.voices.push(VoiceState {
                id: String::new(),
                last_end_tick: note.end_tick,
                last_pitch: note.pitch,
                last_channel: note.channel,
                note_count: 1,
                lowest_pitch: note.pitch,
                highest_pitch: note.pitch,
            });
            next_state.voices.len() - 1
        } else {
            let voice = &mut next_state.voices[target_index];
            voice.last_end_tick = voice.last_end_tick.max(note.end_tick);
            voice.last_pitch = note.pitch;
            voice.last_channel = note.channel;
            voice.note_count += 1;
            voice.lowest_pitch = voice.lowest_pitch.min(note.pitch);
            voice.highest_pitch = voice.highest_pitch.max(note.pitch);
            target_index
        };
        next_state.cost += cost;
        next_state.labels.push(real_index);

        search_window(
            notes,
            pending,
            depth + 1,
            next_state,
            existing_count,
            max_new_voices,
            weights,
            best,
        );
    }
}

/// Replays the winning window labeling against the real, outer `voices`
/// state (allocating a real voice id the first time a "new voice" label is
/// seen), and derives each note's `assignment_confidence`/`assignment_reason`
/// against the *full* compatible-voice set -- not the pruned search
/// shortlist -- so reporting stays accurate even though the search itself
/// only explored a bounded candidate list.
#[allow(clippy::too_many_arguments)]
fn commit_window_result(
    notes: &mut [MidiNoteDto],
    pending: &[usize],
    winning_labels: &[usize],
    existing_count: usize,
    voices: &mut Vec<VoiceState>,
    voice_index_by_id: &mut HashMap<String, usize>,
    reserved_voice_ids: &HashSet<&str>,
    weights: &CostWeights,
) {
    let mut window_label_to_real_index: HashMap<usize, usize> =
        (0..existing_count).map(|index| (index, index)).collect();

    for (&note_index, &window_label) in pending.iter().zip(winning_labels) {
        let real_index = *window_label_to_real_index
            .entry(window_label)
            .or_insert_with(|| {
                let new_id = allocate_new_voice_id(voice_index_by_id, reserved_voice_ids);
                let next_index = voices.len();
                voice_index_by_id.insert(new_id.clone(), next_index);
                voices.push(VoiceState {
                    id: new_id,
                    last_end_tick: 0,
                    last_pitch: notes[note_index].pitch,
                    last_channel: notes[note_index].channel,
                    note_count: 0,
                    lowest_pitch: notes[note_index].pitch,
                    highest_pitch: notes[note_index].pitch,
                });
                next_index
            });

        let note = &mut notes[note_index];
        let is_new_voice = voices[real_index].note_count == 0;
        let compatible = compatible_candidates(voices, note, weights);

        let (confidence, reason) = if is_new_voice {
            (1.0, AssignmentReason::NewVoiceNoFit)
        } else if !compatible
            .iter()
            .any(|candidate| candidate.index == real_index)
        {
            (0.0, AssignmentReason::VoiceCapReached)
        } else {
            let decided_cost = score_candidates(
                std::slice::from_ref(&voices[real_index]),
                note,
                false,
                weights,
            )[0]
            .cost;
            let runner_up_cost = compatible
                .iter()
                .filter(|candidate| candidate.index != real_index)
                .map(|candidate| candidate.cost)
                .fold(f32::INFINITY, f32::min);
            let confidence = if runner_up_cost.is_finite() {
                ((runner_up_cost - decided_cost) / CONFIDENCE_SCALE).clamp(0.0, 1.0)
            } else {
                1.0
            };
            let reason = if voices[real_index].last_channel == note.channel {
                AssignmentReason::ChannelContinuity
            } else {
                AssignmentReason::ClosestPitch
            };
            (confidence, reason)
        };

        note.voice_id.clone_from(&voices[real_index].id);
        note.assignment_confidence = confidence;
        note.assignment_reason = reason;

        let voice = &mut voices[real_index];
        voice.last_end_tick = voice.last_end_tick.max(note.end_tick);
        voice.last_pitch = note.pitch;
        voice.last_channel = note.channel;
        voice.note_count += 1;
        voice.lowest_pitch = voice.lowest_pitch.min(note.pitch);
        voice.highest_pitch = voice.highest_pitch.max(note.pitch);
    }
}

/// Finds the lowest-numbered "voice-N" not already in use by `used_ids` or
/// reserved for a locked voice that hasn't appeared yet in note order.
fn allocate_new_voice_id(
    used_ids: &HashMap<String, usize>,
    reserved_ids: &HashSet<&str>,
) -> String {
    let mut candidate_number = 1_usize;
    loop {
        let candidate = format!("voice-{candidate_number}");
        if !used_ids.contains_key(&candidate) && !reserved_ids.contains(candidate.as_str()) {
            return candidate;
        }
        candidate_number += 1;
    }
}

pub fn summarize_assigned_voices(notes: &[MidiNoteDto]) -> Vec<MidiVoiceDto> {
    let mut voice_ids = notes
        .iter()
        .filter(|note| !note.voice_id.is_empty())
        .map(|note| note.voice_id.clone())
        .collect::<Vec<_>>();
    voice_ids.sort_by(|left, right| voice_order_key(left).cmp(&voice_order_key(right)));
    voice_ids.dedup();

    voice_ids
        .iter()
        .enumerate()
        .map(|(index, voice_id)| {
            let voice_notes = notes
                .iter()
                .filter(|note| note.voice_id == *voice_id)
                .collect::<Vec<_>>();
            MidiVoiceDto {
                id: voice_id.clone(),
                label: format!("Voice {}", index + 1),
                note_count: voice_notes.len(),
                lowest_pitch: voice_notes
                    .iter()
                    .map(|note| note.pitch)
                    .min()
                    .unwrap_or_default(),
                highest_pitch: voice_notes
                    .iter()
                    .map(|note| note.pitch)
                    .max()
                    .unwrap_or_default(),
            }
        })
        .collect()
}

pub fn summarize_separation_quality(notes: &[MidiNoteDto]) -> SeparationSummaryDto {
    if notes.is_empty() {
        return SeparationSummaryDto {
            mean_confidence: 1.0,
            low_confidence_note_count: 0,
            voice_count: 0,
        };
    }

    let total_confidence: f32 = notes.iter().map(|note| note.assignment_confidence).sum();
    let low_confidence_note_count = notes
        .iter()
        .filter(|note| note.assignment_confidence < LOW_CONFIDENCE_THRESHOLD)
        .count();
    let voice_count = notes
        .iter()
        .map(|note| note.voice_id.as_str())
        .collect::<HashSet<_>>()
        .len();

    SeparationSummaryDto {
        mean_confidence: total_confidence / notes.len() as f32,
        low_confidence_note_count,
        voice_count,
    }
}

fn compatible_candidates(
    voices: &[VoiceState],
    note: &MidiNoteDto,
    weights: &CostWeights,
) -> Vec<Candidate> {
    score_candidates(voices, note, true, weights)
}

/// Scores every voice against `note`. When `require_compatible` is true,
/// only non-overlapping ("compatible") voices are scored — this is the
/// normal heuristic path. When false, every voice is scored regardless of
/// overlap, used only for the forced-reuse path once a voice-count cap is
/// reached and no compatible voice exists.
fn score_candidates(
    voices: &[VoiceState],
    note: &MidiNoteDto,
    require_compatible: bool,
    weights: &CostWeights,
) -> Vec<Candidate> {
    voices
        .iter()
        .enumerate()
        .filter(|(_, voice)| !require_compatible || voice.last_end_tick <= note.start_tick)
        .map(|(index, voice)| {
            let pitch_distance = f32::from(voice.last_pitch.abs_diff(note.pitch));
            let register_distance = if voice.note_count >= REGISTER_ESTABLISHED_NOTE_COUNT {
                f32::from(
                    note.pitch
                        .saturating_sub(voice.highest_pitch)
                        .max(voice.lowest_pitch.saturating_sub(note.pitch)),
                )
            } else {
                0.0
            };
            let gap = note.start_tick.saturating_sub(voice.last_end_tick);
            let normalized_gap = (gap as f32 / GAP_NORMALIZATION_TICKS).min(1.0);
            let channel_match = voice.last_channel == note.channel;
            let channel_bonus = if channel_match {
                weights.channel_continuity_bonus
            } else {
                0.0
            };
            Candidate {
                index,
                cost: pitch_distance
                    + register_distance * weights.register_drift_weight
                    + normalized_gap * weights.gap_weight
                    - channel_bonus,
                channel_match,
            }
        })
        .collect()
}

/// Returns the lowest-cost candidate and, if more than one candidate
/// exists, the next-lowest cost (used to derive confidence from how
/// decisively the winner beat the runner-up).
fn best_and_second_cost(candidates: &[Candidate]) -> Option<(Candidate, Option<f32>)> {
    if candidates.is_empty() {
        return None;
    }

    let best = *candidates
        .iter()
        .min_by(|left, right| {
            left.cost
                .partial_cmp(&right.cost)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then(left.index.cmp(&right.index))
        })
        .expect("candidates is non-empty");

    let second_cost = candidates
        .iter()
        .filter(|candidate| candidate.index != best.index)
        .map(|candidate| candidate.cost)
        .min_by(|left, right| left.partial_cmp(right).unwrap_or(std::cmp::Ordering::Equal));

    Some((best, second_cost))
}

fn voice_order_key(voice_id: &str) -> (usize, &str) {
    let numeric_suffix = voice_id
        .strip_prefix("voice-")
        .and_then(|suffix| suffix.parse::<usize>().ok())
        .unwrap_or(usize::MAX);
    (numeric_suffix, voice_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(id: &str, pitch: u8, start_tick: u64, end_tick: u64) -> MidiNoteDto {
        note_with_channel(id, 0, pitch, start_tick, end_tick)
    }

    fn note_with_channel(
        id: &str,
        channel: u8,
        pitch: u8,
        start_tick: u64,
        end_tick: u64,
    ) -> MidiNoteDto {
        MidiNoteDto {
            id: id.to_string(),
            voice_id: String::new(),
            source_track_index: 0,
            channel,
            pitch,
            velocity: 100,
            start_tick,
            end_tick,
            duration_ticks: end_tick - start_tick,
            assignment_confidence: 0.0,
            assignment_reason: AssignmentReason::ClosestPitch,
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
        assert_eq!(notes[1].assignment_reason, AssignmentReason::NewVoiceNoFit);
        assert_eq!(notes[1].assignment_confidence, 1.0);
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

    #[test]
    fn channel_continuity_outweighs_pure_pitch_proximity() {
        let mut notes = vec![
            note_with_channel("a", 0, 60, 0, 120),
            note_with_channel("b", 1, 70, 0, 120),
            note_with_channel("c", 1, 64, 120, 240),
        ];

        assign_heuristic_voices(&mut notes);

        assert_eq!(notes[2].voice_id, "voice-2");
        assert_eq!(
            notes[2].assignment_reason,
            AssignmentReason::ChannelContinuity
        );
    }

    #[test]
    fn confidence_drops_to_zero_for_an_exact_tie() {
        let mut notes = vec![
            note("a", 60, 0, 120),
            note("b", 64, 0, 120),
            note("c", 62, 120, 240),
        ];

        assign_heuristic_voices(&mut notes);

        assert_eq!(notes[2].assignment_confidence, 0.0);
    }

    #[test]
    fn summarizes_existing_assignments_in_voice_order() {
        let mut notes = vec![note("a", 72, 0, 120), note("b", 60, 0, 120)];
        notes[0].voice_id = "voice-2".to_string();
        notes[1].voice_id = "voice-1".to_string();

        let voices = summarize_assigned_voices(&notes);

        assert_eq!(voices.len(), 2);
        assert_eq!(voices[0].id, "voice-1");
        assert_eq!(voices[0].lowest_pitch, 60);
        assert_eq!(voices[1].id, "voice-2");
        assert_eq!(voices[1].highest_pitch, 72);
    }

    #[test]
    fn summarizes_separation_quality_across_notes() {
        let mut low = note("a", 60, 0, 120);
        low.assignment_confidence = 0.2;
        let mut high = note("b", 64, 0, 120);
        high.assignment_confidence = 0.9;
        high.voice_id = "voice-2".to_string();
        low.voice_id = "voice-1".to_string();

        let summary = summarize_separation_quality(&[low, high]);

        assert_eq!(summary.voice_count, 2);
        assert_eq!(summary.low_confidence_note_count, 1);
        assert!((summary.mean_confidence - 0.55).abs() < f32::EPSILON.sqrt());
    }

    #[test]
    fn summarizes_separation_quality_for_no_notes() {
        let summary = summarize_separation_quality(&[]);

        assert_eq!(summary.voice_count, 0);
        assert_eq!(summary.low_confidence_note_count, 0);
        assert_eq!(summary.mean_confidence, 1.0);
    }

    #[test]
    fn locked_note_keeps_its_pinned_voice_and_pulls_a_nearby_unlocked_note() {
        let mut notes = vec![
            note("a", 60, 0, 120),
            note("b", 70, 0, 120),
            note("c", 66, 120, 240),
        ];
        let locked = HashMap::from([("b".to_string(), "voice-9".to_string())]);

        assign_heuristic_voices_with_locks(&mut notes, &locked, None, SeparationStrategy::Balanced);

        assert_eq!(notes[1].voice_id, "voice-9");
        assert_eq!(notes[1].assignment_reason, AssignmentReason::UserLocked);
        assert_eq!(notes[1].assignment_confidence, 1.0);
        // "a" must not collide with the reserved locked id when it opens a
        // brand-new voice.
        assert_eq!(notes[0].voice_id, "voice-1");
        // "c" is closer in pitch to the locked voice's last note (70) than
        // to "a"'s (60), so the cost model should pull it there.
        assert_eq!(notes[2].voice_id, "voice-9");
    }

    #[test]
    fn new_voice_allocation_avoids_a_locked_id_not_yet_encountered() {
        let mut notes = vec![note("early", 60, 0, 120), note("future", 72, 240, 360)];
        let locked = HashMap::from([("future".to_string(), "voice-1".to_string())]);

        assign_heuristic_voices_with_locks(&mut notes, &locked, None, SeparationStrategy::Balanced);

        assert_eq!(notes[0].voice_id, "voice-2");
        assert_eq!(notes[1].voice_id, "voice-1");
        assert_ne!(notes[0].voice_id, notes[1].voice_id);
    }

    #[test]
    fn with_locks_matches_unlocked_assignment_when_nothing_is_locked() {
        let mut with_locks = vec![note("a", 60, 0, 240), note("b", 64, 120, 360)];
        let mut without_locks = with_locks.clone();

        assign_heuristic_voices_with_locks(
            &mut with_locks,
            &HashMap::new(),
            None,
            SeparationStrategy::Balanced,
        );
        assign_heuristic_voices(&mut without_locks);

        let with_locks_ids: Vec<_> = with_locks
            .iter()
            .map(|note| note.voice_id.clone())
            .collect();
        let without_locks_ids: Vec<_> = without_locks
            .iter()
            .map(|note| note.voice_id.clone())
            .collect();
        assert_eq!(with_locks_ids, without_locks_ids);
    }

    #[test]
    fn voice_cap_forces_reuse_instead_of_opening_a_new_voice() {
        let mut notes = vec![note("a", 60, 0, 240), note("b", 64, 120, 360)];

        assign_heuristic_voices_with_locks(
            &mut notes,
            &HashMap::new(),
            Some(1),
            SeparationStrategy::Balanced,
        );

        assert_eq!(notes[0].voice_id, "voice-1");
        assert_eq!(notes[1].voice_id, "voice-1");
        assert_eq!(
            notes[1].assignment_reason,
            AssignmentReason::VoiceCapReached
        );
        assert_eq!(notes[1].assignment_confidence, 0.0);
    }

    #[test]
    fn voice_cap_still_allows_the_very_first_voice() {
        let mut notes = vec![note("a", 60, 0, 240)];

        assign_heuristic_voices_with_locks(
            &mut notes,
            &HashMap::new(),
            Some(0),
            SeparationStrategy::Balanced,
        );

        assert_eq!(notes[0].voice_id, "voice-1");
        assert_eq!(notes[0].assignment_reason, AssignmentReason::NewVoiceNoFit);
    }

    #[test]
    fn register_drift_prefers_a_voice_already_covering_the_pitch_over_a_nearer_last_note() {
        // Build two established voices via locks: "wide" has drifted across
        // a full register (40-90) but its *last* note happens to sit at the
        // low edge (40); "narrow" is tight (66-68) with a last note (68)
        // that's numerically closer to the upcoming test note (88) than
        // wide's last note (40) is. Plain last-pitch distance would prefer
        // "narrow" (20 away) over "wide" (48 away) — but 88 already falls
        // within "wide"'s established range while it would stretch
        // "narrow"'s range by a lot, so the register-aware cost should
        // flip the choice to "wide".
        let mut notes = vec![
            note("w1", 90, 0, 100),
            note("w2", 40, 100, 200),
            note("n1", 66, 0, 100),
            note("n2", 68, 100, 200),
            note("t", 88, 200, 300),
        ];
        let locked = HashMap::from([
            ("w1".to_string(), "voice-wide".to_string()),
            ("w2".to_string(), "voice-wide".to_string()),
            ("n1".to_string(), "voice-narrow".to_string()),
            ("n2".to_string(), "voice-narrow".to_string()),
        ]);

        assign_heuristic_voices_with_locks(&mut notes, &locked, None, SeparationStrategy::Balanced);

        assert_eq!(notes[4].voice_id, "voice-wide");
    }

    #[test]
    fn separation_strategy_changes_which_voice_a_note_lands_in() {
        // Two established voices: "channel" last played on channel 1
        // around pitch 80-82 (far from the test note); "register" last
        // played on channel 0, with an established 38-42 range close to
        // the test note. A pitch-60 test note on channel 1 is a near-tie
        // between them — close enough that swapping which signal
        // (channel match vs. register fit) dominates actually flips the
        // outcome, demonstrating the strategies aren't just numerically
        // different but pick different voices in practice.
        let build_notes = || {
            vec![
                note_with_channel("c1", 1, 80, 0, 100),
                note_with_channel("c2", 1, 82, 100, 200),
                note_with_channel("r1", 0, 38, 0, 100),
                note_with_channel("r2", 0, 42, 100, 200),
                note_with_channel("t", 1, 60, 200, 300),
            ]
        };
        let locked = HashMap::from([
            ("c1".to_string(), "voice-channel".to_string()),
            ("c2".to_string(), "voice-channel".to_string()),
            ("r1".to_string(), "voice-register".to_string()),
            ("r2".to_string(), "voice-register".to_string()),
        ]);

        let mut channel_priority_notes = build_notes();
        assign_heuristic_voices_with_locks(
            &mut channel_priority_notes,
            &locked,
            None,
            SeparationStrategy::ChannelPriority,
        );
        assert_eq!(channel_priority_notes[4].voice_id, "voice-channel");

        let mut register_priority_notes = build_notes();
        assign_heuristic_voices_with_locks(
            &mut register_priority_notes,
            &locked,
            None,
            SeparationStrategy::RegisterPriority,
        );
        assert_eq!(register_priority_notes[4].voice_id, "voice-register");
    }

    #[test]
    fn voice_cap_does_not_block_locked_notes() {
        let mut notes = vec![
            note("a", 60, 0, 240),
            note("b", 64, 0, 240),
            note("c", 68, 0, 240),
        ];
        let locked = HashMap::from([
            ("a".to_string(), "voice-1".to_string()),
            ("b".to_string(), "voice-2".to_string()),
            ("c".to_string(), "voice-3".to_string()),
        ]);

        assign_heuristic_voices_with_locks(
            &mut notes,
            &locked,
            Some(1),
            SeparationStrategy::Balanced,
        );

        // All three overlapping notes are locked to distinct voices; the
        // cap only constrains the unlocked heuristic path, so each keeps
        // its pinned voice rather than being squeezed together.
        assert_eq!(notes[0].voice_id, "voice-1");
        assert_eq!(notes[1].voice_id, "voice-2");
        assert_eq!(notes[2].voice_id, "voice-3");
    }
}

#[cfg(test)]
mod windowed_tests {
    use super::*;

    fn mk(id: &str, channel: u8, pitch: u8, start_tick: u64, end_tick: u64) -> MidiNoteDto {
        MidiNoteDto {
            id: id.to_string(),
            voice_id: String::new(),
            source_track_index: 0,
            channel,
            pitch,
            velocity: 100,
            start_tick,
            end_tick,
            duration_ticks: end_tick - start_tick,
            assignment_confidence: 0.0,
            assignment_reason: AssignmentReason::ClosestPitch,
        }
    }

    #[test]
    fn reuses_a_compatible_voice_like_greedy_does() {
        let mut notes = vec![mk("a", 0, 60, 0, 120), mk("b", 0, 62, 120, 240)];

        let voices = assign_windowed_voices_with_locks(
            &mut notes,
            &HashMap::new(),
            None,
            SeparationStrategy::Balanced,
        );

        assert_eq!(voices.len(), 1);
        assert_eq!(notes[0].voice_id, notes[1].voice_id);
    }

    #[test]
    fn separates_overlapping_notes_like_greedy_does() {
        let mut notes = vec![mk("a", 0, 60, 0, 240), mk("b", 0, 64, 120, 360)];

        let voices = assign_windowed_voices_with_locks(
            &mut notes,
            &HashMap::new(),
            None,
            SeparationStrategy::Balanced,
        );

        assert_eq!(voices.len(), 2);
        assert_ne!(notes[0].voice_id, notes[1].voice_id);
    }

    #[test]
    fn assigns_repeatably() {
        let original = vec![
            mk("a", 0, 60, 0, 240),
            mk("b", 1, 64, 120, 360),
            mk("c", 1, 65, 360, 480),
            mk("d", 0, 67, 480, 600),
        ];
        let mut first = original.clone();
        let mut second = original;

        assign_windowed_voices_with_locks(
            &mut first,
            &HashMap::new(),
            None,
            SeparationStrategy::Balanced,
        );
        assign_windowed_voices_with_locks(
            &mut second,
            &HashMap::new(),
            None,
            SeparationStrategy::Balanced,
        );

        let first_assignments: Vec<_> = first.iter().map(|note| note.voice_id.clone()).collect();
        let second_assignments: Vec<_> = second.iter().map(|note| note.voice_id.clone()).collect();
        assert_eq!(first_assignments, second_assignments);
    }

    #[test]
    fn locked_note_stays_pinned_and_flushes_pending_notes_around_it() {
        let mut notes = vec![
            mk("a", 0, 60, 0, 120),
            mk("b", 0, 70, 0, 120),
            mk("c", 0, 66, 120, 240),
        ];
        let locked = HashMap::from([("b".to_string(), "voice-9".to_string())]);

        assign_windowed_voices_with_locks(&mut notes, &locked, None, SeparationStrategy::Balanced);

        assert_eq!(notes[1].voice_id, "voice-9");
        assert_eq!(notes[1].assignment_reason, AssignmentReason::UserLocked);
        assert_eq!(notes[1].assignment_confidence, 1.0);
    }

    #[test]
    fn voice_cap_forces_reuse_instead_of_opening_a_new_voice() {
        let mut notes = vec![mk("a", 0, 60, 0, 240), mk("b", 0, 64, 120, 360)];

        assign_windowed_voices_with_locks(
            &mut notes,
            &HashMap::new(),
            Some(1),
            SeparationStrategy::Balanced,
        );

        assert_eq!(notes[0].voice_id, notes[1].voice_id);
        assert_eq!(
            notes[1].assignment_reason,
            AssignmentReason::VoiceCapReached
        );
        assert_eq!(notes[1].assignment_confidence, 0.0);
    }

    #[test]
    fn voice_cap_still_allows_the_very_first_voice() {
        let mut notes = vec![mk("a", 0, 60, 0, 240)];

        let voices = assign_windowed_voices_with_locks(
            &mut notes,
            &HashMap::new(),
            Some(0),
            SeparationStrategy::Balanced,
        );

        assert_eq!(voices.len(), 1);
        assert_eq!(notes[0].assignment_reason, AssignmentReason::NewVoiceNoFit);
    }

    /// The concrete counterexample found while investigating whether
    /// greedy ever produces a worse-than-optimal split: `seed-a2` is
    /// cheapest (channel continuity) reused into the "b" voice under
    /// greedy, which then forces `seed-b2` into the "a" voice, permanently
    /// mixing a 49-pitch note with a 68-pitch one -- fragmenting what
    /// should be a clean low/high pitch-register split across every later
    /// free note. A brute-force oracle over this exact note set confirmed
    /// the true minimum-cost partition groups {a1, a2} and {b1, b2}
    /// together instead. This asserts the windowed search actually finds
    /// that grouping, where greedy (verified separately) does not.
    #[test]
    fn finds_the_pitch_register_split_that_greedy_misses() {
        let mut notes = vec![
            mk("seed-a1", 0, 49, 0, 200),
            mk("seed-b1", 1, 65, 0, 200),
            mk("seed-a2", 0, 64, 200, 400),
            mk("seed-b2", 1, 68, 200, 400),
            mk("free-0", 0, 71, 420, 487),
            mk("free-1", 1, 78, 497, 605),
            mk("free-2", 0, 48, 616, 682),
            mk("free-3", 0, 44, 690, 801),
            mk("free-4", 0, 75, 824, 977),
        ];

        // Confirm greedy actually gets this wrong first, so this test
        // documents the contrast rather than asserting an assumption.
        let mut greedy_notes = notes.clone();
        assign_heuristic_voices_with_locks(
            &mut greedy_notes,
            &HashMap::new(),
            None,
            SeparationStrategy::Balanced,
        );
        assert_ne!(
            greedy_notes[0].voice_id, greedy_notes[2].voice_id,
            "greedy is expected to split seed-a1/seed-a2 apart here -- if this now fails, \
             the adversarial fixture no longer demonstrates the gap it was built to show"
        );

        assign_windowed_voices_with_locks(
            &mut notes,
            &HashMap::new(),
            None,
            SeparationStrategy::Balanced,
        );

        assert_eq!(
            notes[0].voice_id, notes[2].voice_id,
            "seed-a1 and seed-a2 should land in the same voice"
        );
        assert_eq!(
            notes[1].voice_id, notes[3].voice_id,
            "seed-b1 and seed-b2 should land in the same voice"
        );
        assert_ne!(notes[0].voice_id, notes[1].voice_id);
    }

    /// Replays a committed assignment's real note->voice_id mapping through
    /// the same cost formula used to produce it, giving the actual total
    /// cost being minimized -- unlike `assignment_confidence`, which
    /// measures how locally decisive a single pick was, not whether the
    /// overall grouping is cheaper.
    fn total_cost_of_committed_assignment(notes: &[MidiNoteDto], weights: &CostWeights) -> f32 {
        let mut voice_states: HashMap<String, VoiceState> = HashMap::new();
        let mut total = 0.0f32;

        for note in notes {
            if let Some(voice) = voice_states.get(&note.voice_id) {
                total +=
                    score_candidates(std::slice::from_ref(voice), note, false, weights)[0].cost;
            }

            let voice = voice_states
                .entry(note.voice_id.clone())
                .or_insert_with(|| VoiceState {
                    id: note.voice_id.clone(),
                    last_end_tick: note.end_tick,
                    last_pitch: note.pitch,
                    last_channel: note.channel,
                    note_count: 0,
                    lowest_pitch: note.pitch,
                    highest_pitch: note.pitch,
                });
            voice.last_end_tick = voice.last_end_tick.max(note.end_tick);
            voice.last_pitch = note.pitch;
            voice.last_channel = note.channel;
            voice.note_count += 1;
            voice.lowest_pitch = voice.lowest_pitch.min(note.pitch);
            voice.highest_pitch = voice.highest_pitch.max(note.pitch);
        }

        total
    }

    /// Real, dense, non-synthetic regression coverage (see
    /// `fixtures/README.md` for provenance/license and how this file was
    /// chosen): confirms `Global` doesn't just work on the constructed
    /// adversarial cases above, but actually finds an equal-or-lower-cost
    /// partition than `Greedy` on real music, across every strategy.
    #[test]
    fn global_mode_matches_or_beats_greedy_cost_on_a_real_dense_fixture() {
        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("fixtures")
            .join("boss-battle-6-combined.mid");
        let bytes = std::fs::read(&path).expect("fixture should be readable");
        let project =
            super::super::parser::parse_midi_project(&path, &bytes).expect("fixture should parse");

        for strategy in [
            SeparationStrategy::Balanced,
            SeparationStrategy::ChannelPriority,
            SeparationStrategy::RegisterPriority,
            SeparationStrategy::StrictChannel,
        ] {
            let weights = strategy.cost_weights();

            let mut greedy_notes = project.notes.clone();
            assign_voices_with_locks(
                &mut greedy_notes,
                &HashMap::new(),
                None,
                strategy,
                AssignmentMode::Greedy,
            );
            let greedy_cost = total_cost_of_committed_assignment(&greedy_notes, &weights);

            let mut global_notes = project.notes.clone();
            assign_voices_with_locks(
                &mut global_notes,
                &HashMap::new(),
                None,
                strategy,
                AssignmentMode::Global,
            );
            let global_cost = total_cost_of_committed_assignment(&global_notes, &weights);

            assert!(
                global_cost <= greedy_cost + 1e-3,
                "{strategy:?}: Global cost {global_cost} should be <= Greedy cost {greedy_cost} \
                 on a real dense fixture"
            );
        }
    }
}
