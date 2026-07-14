use std::cmp::Ordering;
use std::collections::{HashMap, HashSet, VecDeque};

use super::model::{
    AssignmentMode, AssignmentReason, MidiNoteDto, MidiVoiceDto, SeparationStrategy,
    SeparationSummaryDto, VoiceRoleDto,
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
    /// Cost added per concurrently sounding voice this assignment would
    /// leap over: another voice whose current pitch lies strictly between
    /// the candidate voice's last pitch and the new note's pitch, and
    /// whose last note is still sounding at the new note's start.
    /// "Avoid voice crossing" is one of the strongest perceptual
    /// voice-leading principles (Temperley, Huron), and without this term
    /// nothing stops a low voice from taking a note above a currently
    /// sounding higher voice when the raw pitch distance happens to be
    /// smaller.
    crossing_weight: f32,
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
                crossing_weight: 2.0,
            },
            // For files where each instrument already lives on a stable
            // MIDI channel: channel match dominates over a moderate
            // pitch jump.
            SeparationStrategy::ChannelPriority => CostWeights {
                gap_weight: 4.0,
                channel_continuity_bonus: 12.0,
                register_drift_weight: 1.5,
                crossing_weight: 2.0,
            },
            // For files where channel is a weak signal (e.g. most of the
            // piece crammed onto one MIDI channel): keeping a voice's
            // pitch range tight matters far more than channel
            // continuity. Crossing a sounding voice is weighted higher
            // here for the same reason the register term is: pitch
            // structure is all this strategy has to go on.
            SeparationStrategy::RegisterPriority => CostWeights {
                gap_weight: 4.0,
                channel_continuity_bonus: 1.0,
                register_drift_weight: 4.0,
                crossing_weight: 3.0,
            },
            // Channel match wins whenever a same-channel compatible
            // voice exists at all; pitch only decides ties, picks among
            // multiple same-channel candidates, or matters when no
            // same-channel voice is available yet. Effectively "one
            // voice per channel" without a second algorithm. No crossing
            // term: distinct instruments cross registers all the time
            // (melody vs. accompaniment), and channel identity is the
            // whole point of this preset.
            SeparationStrategy::StrictChannel => CostWeights {
                gap_weight: 4.0,
                channel_continuity_bonus: 1000.0,
                register_drift_weight: 0.0,
                crossing_weight: 0.0,
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

/// MIDI channel 10 (0-indexed 9) is percussion under General MIDI: note
/// numbers there are drum identities, not pitches.
pub const PERCUSSION_CHANNEL: u8 = 9;
/// Dedicated voice id for channel-10 notes. Never collides with the
/// heuristic's own `voice-N` ids by construction.
pub const PERCUSSION_VOICE_ID: &str = "percussion";
const PERCUSSION_VOICE_LABEL: &str = "Percussion";

pub fn assign_heuristic_voices(notes: &mut [MidiNoteDto]) -> Vec<MidiVoiceDto> {
    assign_voices_with_locks(
        notes,
        &HashMap::new(),
        None,
        SeparationStrategy::Balanced,
        AssignmentMode::Greedy,
    )
}

/// Assigns every note a voice: channel-10 percussion goes to a dedicated
/// voice (its note numbers are drum identities, not pitches — the
/// pitch/register cost model must never score them), and the remaining
/// pitched notes run through whichever algorithm `mode` selects, with
/// `strategy` picking the cost weighting. A user lock on a percussion
/// note wins over the percussion routing, like locks win everywhere; the
/// percussion voice sits outside `max_voice_count`, since it isn't a
/// heuristic guess that a cap should be able to squeeze.
pub fn assign_voices_with_locks(
    notes: &mut [MidiNoteDto],
    locked: &HashMap<String, String>,
    max_voice_count: Option<usize>,
    strategy: SeparationStrategy,
    mode: AssignmentMode,
) -> Vec<MidiVoiceDto> {
    let percussion_indices: Vec<usize> = notes
        .iter()
        .enumerate()
        .filter(|(_, note)| note.channel == PERCUSSION_CHANNEL && !locked.contains_key(&note.id))
        .map(|(index, _)| index)
        .collect();

    if percussion_indices.is_empty() {
        return run_assignment_mode(notes, locked, max_voice_count, strategy, mode);
    }

    for &index in &percussion_indices {
        let note = &mut notes[index];
        note.voice_id = PERCUSSION_VOICE_ID.to_string();
        note.assignment_confidence = 1.0;
        note.assignment_reason = AssignmentReason::Percussion;
    }

    // Run the chosen algorithm over the pitched notes only, then write the
    // results back into their original slots.
    let pitched_indices: Vec<usize> = (0..notes.len())
        .filter(|index| {
            notes[*index].channel != PERCUSSION_CHANNEL || locked.contains_key(&notes[*index].id)
        })
        .collect();
    let mut pitched: Vec<MidiNoteDto> = pitched_indices
        .iter()
        .map(|&index| notes[index].clone())
        .collect();
    let mut voices = run_assignment_mode(&mut pitched, locked, max_voice_count, strategy, mode);
    for (position, &index) in pitched_indices.iter().enumerate() {
        notes[index] = pitched[position].clone();
    }

    let percussion_pitches: Vec<u8> = percussion_indices
        .iter()
        .map(|&index| notes[index].pitch)
        .collect();
    let lowest = percussion_pitches.iter().copied().min().unwrap_or_default();
    let highest = percussion_pitches.iter().copied().max().unwrap_or_default();
    // A user can lock a pitched note into the percussion voice, in which
    // case the algorithm already created a voice with this id — fold the
    // percussion notes into it instead of listing the id twice.
    match voices
        .iter_mut()
        .find(|voice| voice.id == PERCUSSION_VOICE_ID)
    {
        Some(existing) => {
            existing.role = VoiceRoleDto::Percussion;
            existing.note_count += percussion_pitches.len();
            existing.lowest_pitch = existing.lowest_pitch.min(lowest);
            existing.highest_pitch = existing.highest_pitch.max(highest);
        }
        None => voices.push(MidiVoiceDto {
            id: PERCUSSION_VOICE_ID.to_string(),
            label: PERCUSSION_VOICE_LABEL.to_string(),
            role: VoiceRoleDto::Percussion,
            note_count: percussion_pitches.len(),
            lowest_pitch: lowest,
            highest_pitch: highest,
        }),
    }
    voices
}

/// Dispatches to whichever assignment algorithm `mode` selects. `strategy`
/// (the cost weighting) applies to any of them.
fn run_assignment_mode(
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
        AssignmentMode::Contig => {
            assign_contig_voices_with_locks(notes, locked, max_voice_count, strategy)
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
            role: VoiceRoleDto::Melodic,
            note_count: voice.note_count,
            lowest_pitch: voice.lowest_pitch,
            highest_pitch: voice.highest_pitch,
        })
        .collect()
}

/// Size of the sliding lookahead window: once this many unlocked notes are
/// pending, each new note triggers one commit (the oldest pending note) so
/// every unlocked note is finalized only after the search has already seen
/// this many notes' worth of what comes after it. Larger catches
/// divergences (like the demonstrated case where an early
/// channel-continuity pick forced a much worse split several notes later)
/// that span a wider gap. The window search is a beam (see `BEAM_WIDTH`),
/// so widening this costs linearly rather than `candidates ^ window` --
/// which is what allowed 6 (the old exhaustive search's affordable
/// ceiling) to become 16. Run once per note, not once per window, since
/// the window slides by one note at a time rather than resetting after
/// each commit.
const LOOKAHEAD_WINDOW: usize = 16;
/// How many of the cheapest compatible voices are actually explored per
/// note during the window search (plus "open a new voice" when budget
/// allows). Bounds the branching factor independent of how many voices
/// already exist in a long piece -- final confidence/reason reporting
/// still checks every compatible voice, not just this shortlist, so
/// pruning here only affects the search, never the reported numbers.
const LOOKAHEAD_CANDIDATES_PER_NOTE: usize = 3;
/// How many partial assignments survive each depth of the window search.
/// The original search was exhaustive with branch-and-bound pruning,
/// whose `candidates ^ window` blowup capped the affordable window at ~6
/// notes; keeping only the `BEAM_WIDTH` cheapest partial states per note
/// makes each window solve linear in its length instead, buying a much
/// longer foresight horizon for a similar budget. The trade-off is that a
/// partial assignment whose payoff only appears deep into the window can
/// be pruned before that payoff is visible; in exchange, divergences
/// spanning up to `LOOKAHEAD_WINDOW` notes (not 6) are visible to the
/// search at all.
const BEAM_WIDTH: usize = 32;

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
/// compatible voice immediately, keeps a *sliding* window of up to
/// `LOOKAHEAD_WINDOW` pending unlocked notes: once the window is full, each
/// new note triggers one commit (the search is re-run over the full
/// window, but only its oldest pending note is actually finalized) before
/// that note joins the window itself. A locked note flushes whatever is
/// currently pending first (locks can't be reordered around), then is
/// pinned exactly as in the greedy path.
///
/// This directly addresses greedy's known failure mode: an early note can
/// have a locally-cheapest voice that, a few notes later, turns out to have
/// foreclosed a much better overall split (e.g. a clean low/high
/// pitch-register grouping) that greedy could never see coming because it
/// never revisits a commitment. Sliding one note at a time (rather than
/// committing a whole fixed chunk at once) means every unlocked note gets
/// the same `LOOKAHEAD_WINDOW - 1` notes of foresight regardless of where
/// it falls in the piece, instead of sometimes getting none because it
/// happened to land last in a chunk -- the earlier, chunked version of this
/// search had exactly that blind spot at each chunk boundary. It is still
/// not whole-piece-optimal -- the window search is a width-bounded beam
/// (`BEAM_WIDTH`), not exhaustive, and a divergence spanning more than
/// `LOOKAHEAD_WINDOW` notes can still slip through.
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
    let mut pending: VecDeque<usize> = VecDeque::new();

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

        if pending.len() == LOOKAHEAD_WINDOW {
            slide_pending_window(
                notes,
                &mut pending,
                &mut voices,
                &mut voice_index_by_id,
                &reserved_voice_ids,
                max_voice_count,
                &weights,
            );
        }
        pending.push_back(index);
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
            role: VoiceRoleDto::Melodic,
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

/// Exhaustively solves the current `pending` window against the
/// already-committed `voices`, without committing anything -- shared by
/// `flush_pending_window` (which commits every note in the result) and
/// `slide_pending_window` (which commits only the oldest one).
fn solve_pending_window(
    notes: &[MidiNoteDto],
    pending: &[usize],
    voices: &[VoiceState],
    max_voice_count: Option<usize>,
    weights: &CostWeights,
) -> WindowSearchState {
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
        voices: voices.to_vec(),
        cost: 0.0,
        labels: Vec::with_capacity(pending.len()),
    };
    let mut beam: Vec<WindowSearchState> = vec![initial_state];
    for &note_index in pending {
        let note = &notes[note_index];
        // Expand without cloning first: (projected total cost, parent
        // position in the beam, target voice index, step cost, opens new
        // voice). Cloning a parent's voice list is by far the most
        // expensive part of the search, so pruned expansions must never
        // pay for it.
        let mut expansions: Vec<(f32, usize, usize, f32, bool)> = Vec::new();
        for (parent_position, state) in beam.iter().enumerate() {
            for (target_index, cost, is_new) in
                branch_targets(state, note, existing_count, max_new_voices, weights)
            {
                expansions.push((
                    state.cost + cost,
                    parent_position,
                    target_index,
                    cost,
                    is_new,
                ));
            }
        }
        // Keep the `BEAM_WIDTH` cheapest expansions, then materialize just
        // those. Ties break on (parent position, target index), both
        // deterministic, so the survivors -- and therefore the whole
        // assignment -- don't depend on float quirks. Partition before
        // sorting so only the survivors pay the sort.
        let expansion_order =
            |left: &(f32, usize, usize, f32, bool), right: &(f32, usize, usize, f32, bool)| {
                left.0
                    .partial_cmp(&right.0)
                    .unwrap_or(Ordering::Equal)
                    .then(left.1.cmp(&right.1))
                    .then(left.2.cmp(&right.2))
            };
        if expansions.len() > BEAM_WIDTH {
            expansions.select_nth_unstable_by(BEAM_WIDTH - 1, expansion_order);
            expansions.truncate(BEAM_WIDTH);
        }
        expansions.sort_by(expansion_order);

        let mut next_beam: Vec<WindowSearchState> = Vec::with_capacity(expansions.len());
        for (_, parent_position, target_index, cost, is_new) in expansions {
            let mut next_state = beam[parent_position].clone();
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
            next_beam.push(next_state);
        }
        beam = next_beam;
    }
    // `beam` is sorted by cost (the expansions were), so the first entry is
    // the cheapest full assignment.
    beam.into_iter()
        .next()
        .expect("the beam always retains at least one assignment for non-empty pending")
}

/// Solves and commits every note currently buffered in `pending`, leaving
/// it empty. Used for the final trailing notes at end of input and to
/// resolve whatever's pending immediately before a locked note (which can't
/// itself join the sliding window). No-op if `pending` is empty.
#[allow(clippy::too_many_arguments)]
fn flush_pending_window(
    notes: &mut [MidiNoteDto],
    pending: &mut VecDeque<usize>,
    voices: &mut Vec<VoiceState>,
    voice_index_by_id: &mut HashMap<String, usize>,
    reserved_voice_ids: &HashSet<&str>,
    max_voice_count: Option<usize>,
    weights: &CostWeights,
) {
    if pending.is_empty() {
        return;
    }

    let pending_notes: Vec<usize> = pending.iter().copied().collect();
    let existing_count = voices.len();
    let best = solve_pending_window(notes, &pending_notes, voices, max_voice_count, weights);

    commit_window_result(
        notes,
        &pending_notes,
        &best.labels,
        existing_count,
        voices,
        voice_index_by_id,
        reserved_voice_ids,
        weights,
    );

    pending.clear();
}

/// Solves the current (full, size `LOOKAHEAD_WINDOW`) `pending` window, but
/// commits only its oldest note -- the one about to slide out -- leaving
/// the rest still pending so they get reconsidered alongside whatever note
/// joins the window next. This is what makes the search a sliding window
/// rather than a sequence of independently committed chunks: every note is
/// finalized only after the search has already seen the `LOOKAHEAD_WINDOW - 1`
/// notes that come after it.
#[allow(clippy::too_many_arguments)]
fn slide_pending_window(
    notes: &mut [MidiNoteDto],
    pending: &mut VecDeque<usize>,
    voices: &mut Vec<VoiceState>,
    voice_index_by_id: &mut HashMap<String, usize>,
    reserved_voice_ids: &HashSet<&str>,
    max_voice_count: Option<usize>,
    weights: &CostWeights,
) {
    let pending_notes: Vec<usize> = pending.iter().copied().collect();
    let existing_count = voices.len();
    let best = solve_pending_window(notes, &pending_notes, voices, max_voice_count, weights);

    commit_window_result(
        notes,
        &pending_notes[..1],
        &best.labels[..1],
        existing_count,
        voices,
        voice_index_by_id,
        reserved_voice_ids,
        weights,
    );

    pending.pop_front();
}

/// The branch targets the beam explores for `note` from `state`: the
/// `LOOKAHEAD_CANDIDATES_PER_NOTE` cheapest compatible voices (plus "open
/// a new voice" when the budget allows), where a voice is either one of
/// the first `existing_count` entries of `state.voices`
/// (already-committed, real) or one opened earlier along this partial
/// assignment. If no voice is compatible and no new-voice budget remains,
/// falls back to the single cheapest voice overall, mirroring greedy's
/// at-the-cap behavior. Returns `(voice index, cost, opens_new_voice)`
/// tuples.
fn branch_targets(
    state: &WindowSearchState,
    note: &MidiNoteDto,
    existing_count: usize,
    max_new_voices: usize,
    weights: &CostWeights,
) -> Vec<(usize, f32, bool)> {
    let new_voice_count = state.voices.len() - existing_count;
    let can_open_new = new_voice_count < max_new_voices;

    // This runs for every beam state at every window depth, so it's the
    // hottest loop in Global mode: one scoring call over the whole voice
    // list (per-call overhead dominates if scoring is done
    // voice-by-voice), and a capped insertion instead of sorting all
    // candidates to find the top few.
    let mut top: Vec<(usize, f32)> = Vec::with_capacity(LOOKAHEAD_CANDIDATES_PER_NOTE + 1);
    let mut best_forced: Option<(usize, f32)> = None;
    for candidate in score_candidates(&state.voices, note, false, weights) {
        if best_forced.is_none_or(|(_, best_cost)| candidate.cost < best_cost) {
            best_forced = Some((candidate.index, candidate.cost));
        }
        if state.voices[candidate.index].last_end_tick <= note.start_tick {
            // Candidates arrive in voice-index order, and `<=` in the
            // partition point places an equal-cost newcomer after the
            // incumbents -- together giving the same lowest-index-wins tie
            // behavior a stable sort had.
            let position = top.partition_point(|&(_, cost)| cost <= candidate.cost);
            if position < LOOKAHEAD_CANDIDATES_PER_NOTE {
                top.insert(position, (candidate.index, candidate.cost));
                top.truncate(LOOKAHEAD_CANDIDATES_PER_NOTE);
            }
        }
    }

    let mut targets: Vec<(usize, f32, bool)> = Vec::with_capacity(top.len() + 1);
    if !top.is_empty() {
        for (index, cost) in top {
            targets.push((index, cost, false));
        }
        if can_open_new {
            targets.push((state.voices.len(), 0.0, true));
        }
    } else if can_open_new {
        targets.push((state.voices.len(), 0.0, true));
    } else if let Some((index, cost)) = best_forced {
        targets.push((index, cost, false));
    }
    targets
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
            // Full-slice scoring (indices align with `voices`) so the
            // decided cost carries the same crossing context the
            // compatible candidates were scored with.
            let decided_cost = score_candidates(voices, note, false, weights)[real_index].cost;
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

/// Cost charged by the contig boundary alignment for opening a brand-new
/// chain instead of continuing an existing compatible one. Deliberately far
/// above any achievable match cost (pitch distance <= 127, register
/// distance <= 127 * the largest register weight, gap penalty <=
/// `gap_weight`), so the alignment only opens a new chain when there are
/// structurally more fragments than compatible chains -- the same "never
/// open a new voice while a compatible one exists" convention the greedy
/// path gets from its candidate filter.
const NEW_CHAIN_PENALTY: f32 = 100_000.0;

/// One voice-line's worth of notes within a single contig: a time-ordered
/// run of non-overlapping notes occupying the same pitch position. If
/// `held_seed` is true, the first note was already sounding when the contig
/// began (it started in an earlier contig), which forces this fragment to
/// continue whatever chain that note was already committed to.
struct Fragment {
    note_indices: Vec<usize>,
    held_seed: bool,
}

/// A maximal time span over which the number of simultaneously sounding
/// notes is constant. Within a contig, voice-leading is treated as
/// unambiguous (fragments are pitch-ordered and successions are matched by
/// pitch order); all real decisions happen where contigs meet.
struct Contig {
    start_tick: u64,
    fragments: Vec<Fragment>,
}

/// A voice being built up across contigs: its accumulated scoring state
/// (`VoiceState` with the id left empty until ids are assigned at the end)
/// plus every note committed to it so far, in time order.
struct ChainBuild {
    state: VoiceState,
    note_indices: Vec<usize>,
}

/// End tick used for the polyphony sweep only. A zero-length note (the
/// parser emits a `ZeroLengthNote` warning but keeps the note) would never
/// "sound" under its literal end tick and would silently fall out of every
/// contig, so it is treated as lasting one tick here. Scoring and committed
/// chain state still use the note's real `end_tick`.
fn effective_sweep_end(note: &MidiNoteDto) -> u64 {
    note.end_tick.max(note.start_tick + 1)
}

/// Pairs the notes departing at an in-contig succession tick with the notes
/// arriving at it (`departing` and `arriving` have equal length -- that's
/// what makes it a succession rather than a contig boundary). Same-channel
/// pairs are matched first, by pitch order within the channel: a note
/// replaced at the same instant by another note on the same MIDI channel is
/// almost surely the same instrument continuing, whatever the pitch jump --
/// a signal the original contig-mapping formulation (built for channel-less
/// symbolic data) never had. Whatever remains after channel grouping is
/// matched across channels by plain pitch order, the contig-mapping
/// default, which is also the overall behavior for single-channel files.
fn match_succession(
    notes: &[MidiNoteDto],
    departing: &[usize],
    arriving: &[usize],
) -> Vec<(usize, usize)> {
    let mut pairs: Vec<(usize, usize)> = Vec::with_capacity(departing.len());
    let mut leftover_departing: Vec<usize> = Vec::new();
    let mut leftover_arriving: Vec<usize> = arriving.to_vec();

    let mut channels: Vec<u8> = departing
        .iter()
        .map(|&index| notes[index].channel)
        .collect();
    channels.sort_unstable();
    channels.dedup();
    for channel in channels {
        let mut channel_departing: Vec<usize> = departing
            .iter()
            .copied()
            .filter(|&index| notes[index].channel == channel)
            .collect();
        let mut channel_arriving: Vec<usize> = leftover_arriving
            .iter()
            .copied()
            .filter(|&index| notes[index].channel == channel)
            .collect();
        channel_departing.sort_by_key(|&index| (notes[index].pitch, index));
        channel_arriving.sort_by_key(|&index| (notes[index].pitch, index));
        let paired = channel_departing.len().min(channel_arriving.len());
        for position in 0..paired {
            pairs.push((channel_departing[position], channel_arriving[position]));
        }
        leftover_arriving.retain(|index| !channel_arriving[..paired].contains(index));
        leftover_departing.extend_from_slice(&channel_departing[paired..]);
    }

    leftover_departing.sort_by_key(|&index| (notes[index].pitch, index));
    leftover_arriving.sort_by_key(|&index| (notes[index].pitch, index));
    for (&departed, &arrived) in leftover_departing.iter().zip(&leftover_arriving) {
        pairs.push((departed, arrived));
    }
    pairs
}

/// Segments `notes` into contigs. Boundaries fall wherever the number of
/// simultaneously sounding notes changes (silence ends a contig). At a tick
/// where the count stays constant but notes are replaced (equally many end
/// and start), the departing notes are matched to the arriving ones --
/// same-channel first, then by pitch order; see `match_succession` -- and
/// each arriving note continues its match's fragment. That succession is
/// the "unambiguous within a contig" part of the contig-mapping approach.
fn build_contigs(notes: &[MidiNoteDto]) -> Vec<Contig> {
    let mut start_order: Vec<usize> = (0..notes.len()).collect();
    start_order.sort_by_key(|&index| (notes[index].start_tick, index));

    let mut boundary_ticks: Vec<u64> = notes
        .iter()
        .flat_map(|note| [note.start_tick, effective_sweep_end(note)])
        .collect();
    boundary_ticks.sort_unstable();
    boundary_ticks.dedup();

    let mut contigs: Vec<Contig> = Vec::new();
    let mut current: Option<Contig> = None;
    // Note index -> fragment index within `current`.
    let mut fragment_of_note: HashMap<usize, usize> = HashMap::new();
    let mut active: Vec<usize> = Vec::new();
    let mut next_start = 0usize;

    for &tick in &boundary_ticks {
        let previous_count = active.len();
        let departing: Vec<usize> = active
            .iter()
            .copied()
            .filter(|&index| effective_sweep_end(&notes[index]) == tick)
            .collect();
        active.retain(|&index| effective_sweep_end(&notes[index]) != tick);
        let mut arriving: Vec<usize> = Vec::new();
        while next_start < start_order.len() && notes[start_order[next_start]].start_tick == tick {
            arriving.push(start_order[next_start]);
            next_start += 1;
        }
        active.extend(arriving.iter().copied());
        let new_count = active.len();

        if new_count == previous_count {
            if arriving.is_empty() {
                // A boundary tick belonging to notes sounding elsewhere in
                // the piece; nothing changed here.
                continue;
            }
            // Constant count with replacements: an in-contig succession
            // event, so `departing` and `arriving` have equal length.
            let contig = current
                .as_mut()
                .expect("a nonzero constant count means a contig is open");
            for (departed, arrived) in match_succession(notes, &departing, &arriving) {
                let fragment_index = fragment_of_note[&departed];
                contig.fragments[fragment_index].note_indices.push(arrived);
                fragment_of_note.insert(arrived, fragment_index);
            }
            continue;
        }

        // Polyphony changed: the current contig (if any) ends at this tick.
        if let Some(finished) = current.take() {
            contigs.push(finished);
        }
        fragment_of_note.clear();
        if new_count == 0 {
            continue;
        }

        // Open a new contig: every sounding note seeds one fragment, in
        // pitch order. A seed already sounding before this tick is held --
        // it was committed to a chain by the contig it started in.
        let mut seeds: Vec<usize> = active.clone();
        seeds.sort_by_key(|&index| (notes[index].pitch, index));
        let fragments: Vec<Fragment> = seeds
            .iter()
            .enumerate()
            .map(|(fragment_index, &index)| {
                fragment_of_note.insert(index, fragment_index);
                Fragment {
                    note_indices: vec![index],
                    held_seed: notes[index].start_tick < tick,
                }
            })
            .collect();
        current = Some(Contig {
            start_tick: tick,
            fragments,
        });
    }

    if let Some(finished) = current.take() {
        contigs.push(finished);
    }
    contigs
}

/// Non-crossing minimum-cost alignment between the pitch-ordered resting
/// chains (`available`, chain indices whose last note ends at or before the
/// contig start) and the contig's pitch-ordered fresh fragments
/// (`fresh_fragments`, fragment indices whose seed is not held). Classic
/// sequence-alignment DP: a chain may be skipped (that voice rests through
/// this contig), a fragment may open a new chain (charged
/// `NEW_CHAIN_PENALTY`, so it only happens when structurally necessary), or
/// a chain and fragment may be matched at the cost of scoring the
/// fragment's first note against the chain's accumulated state. The
/// non-crossing constraint is the perceptual "voices don't cross" principle
/// the contig approach is built on. Returns, per fresh fragment, the
/// matched chain index or `None` (wants a new chain).
fn align_fragments_to_chains(
    notes: &[MidiNoteDto],
    chains: &[ChainBuild],
    available: &[usize],
    contig: &Contig,
    fresh_fragments: &[usize],
    weights: &CostWeights,
) -> Vec<Option<usize>> {
    let chain_count = available.len();
    let fragment_count = fresh_fragments.len();

    // Score each fragment's first note against every chain in one call
    // (result indices align with `chains`), so the costs carry crossing
    // context from chains held through this boundary.
    let chain_states: Vec<VoiceState> = chains.iter().map(|chain| chain.state.clone()).collect();
    let costs_by_fragment: Vec<Vec<Candidate>> = fresh_fragments
        .iter()
        .map(|&fragment_index| {
            let first_note = &notes[contig.fragments[fragment_index].note_indices[0]];
            score_candidates(&chain_states, first_note, false, weights)
        })
        .collect();
    let match_cost: Vec<Vec<f32>> = available
        .iter()
        .map(|&chain_index| {
            costs_by_fragment
                .iter()
                .map(|candidates| candidates[chain_index].cost)
                .collect()
        })
        .collect();

    // dp[i][j]: min cost aligning the first i chains with the first j
    // fragments. choice: 0 = skip chain, 1 = new chain for fragment,
    // 2 = match.
    let mut dp = vec![vec![f32::INFINITY; fragment_count + 1]; chain_count + 1];
    let mut choice = vec![vec![0u8; fragment_count + 1]; chain_count + 1];
    dp[0][0] = 0.0;
    for j in 1..=fragment_count {
        dp[0][j] = dp[0][j - 1] + NEW_CHAIN_PENALTY;
        choice[0][j] = 1;
    }
    for i in 1..=chain_count {
        dp[i][0] = dp[i - 1][0];
        choice[i][0] = 0;
    }
    for i in 1..=chain_count {
        for j in 1..=fragment_count {
            let mut best = dp[i - 1][j];
            let mut pick = 0u8;
            let new_chain = dp[i][j - 1] + NEW_CHAIN_PENALTY;
            if new_chain < best {
                best = new_chain;
                pick = 1;
            }
            let matched = dp[i - 1][j - 1] + match_cost[i - 1][j - 1];
            if matched < best {
                best = matched;
                pick = 2;
            }
            dp[i][j] = best;
            choice[i][j] = pick;
        }
    }

    let mut result = vec![None; fragment_count];
    let (mut i, mut j) = (chain_count, fragment_count);
    while i > 0 || j > 0 {
        match choice[i][j] {
            0 => i -= 1,
            1 => j -= 1,
            _ => {
                i -= 1;
                j -= 1;
                result[j] = Some(available[i]);
            }
        }
    }
    result
}

fn create_chain(chains: &mut Vec<ChainBuild>, note: &MidiNoteDto) -> usize {
    chains.push(ChainBuild {
        state: VoiceState {
            id: String::new(),
            last_end_tick: 0,
            last_pitch: note.pitch,
            last_channel: note.channel,
            note_count: 0,
            lowest_pitch: note.pitch,
            highest_pitch: note.pitch,
        },
        note_indices: Vec::new(),
    });
    chains.len() - 1
}

fn append_note_to_chain(chain: &mut ChainBuild, note_index: usize, note: &MidiNoteDto) {
    chain.note_indices.push(note_index);
    let state = &mut chain.state;
    // `max`, not overwrite: a cap-forced fragment can overlap notes already
    // in the chain, so its notes aren't guaranteed to end last.
    state.last_end_tick = state.last_end_tick.max(note.end_tick);
    state.last_pitch = note.pitch;
    state.last_channel = note.channel;
    state.note_count += 1;
    state.lowest_pitch = state.lowest_pitch.min(note.pitch);
    state.highest_pitch = state.highest_pitch.max(note.pitch);
}

/// Recomputes every note's `assignment_confidence`/`assignment_reason` by
/// replaying the committed voice ids in time order through the same scoring
/// the other modes report with (mirroring `commit_window_result`'s rules):
/// a locked note is `UserLocked`/1.0, the first note of a voice is
/// `NewVoiceNoFit`/1.0, a note committed to a voice it overlaps in time is
/// `VoiceCapReached`/0.0, and everything else derives confidence from the
/// cost gap between the committed voice and the best compatible
/// alternative.
fn replay_assignment_reporting(
    notes: &mut [MidiNoteDto],
    locked: &HashMap<String, String>,
    weights: &CostWeights,
) {
    let mut order: Vec<usize> = (0..notes.len()).collect();
    order.sort_by_key(|&index| (notes[index].start_tick, index));

    let mut states: Vec<VoiceState> = Vec::new();
    let mut state_index_by_id: HashMap<String, usize> = HashMap::new();

    for index in order {
        let voice_id = notes[index].voice_id.clone();
        let existing = state_index_by_id.get(&voice_id).copied();

        let (confidence, reason) = if locked.contains_key(&notes[index].id) {
            (1.0, AssignmentReason::UserLocked)
        } else {
            match existing {
                None => (1.0, AssignmentReason::NewVoiceNoFit),
                Some(state_index) => {
                    let note = &notes[index];
                    let compatible = compatible_candidates(&states, note, weights);
                    if !compatible
                        .iter()
                        .any(|candidate| candidate.index == state_index)
                    {
                        (0.0, AssignmentReason::VoiceCapReached)
                    } else {
                        // Full-slice scoring (indices align with `states`)
                        // so the decided cost carries the same crossing
                        // context the compatible candidates were scored
                        // with.
                        let decided_cost =
                            score_candidates(&states, note, false, weights)[state_index].cost;
                        let runner_up_cost = compatible
                            .iter()
                            .filter(|candidate| candidate.index != state_index)
                            .map(|candidate| candidate.cost)
                            .fold(f32::INFINITY, f32::min);
                        let confidence = if runner_up_cost.is_finite() {
                            ((runner_up_cost - decided_cost) / CONFIDENCE_SCALE).clamp(0.0, 1.0)
                        } else {
                            1.0
                        };
                        let reason = if states[state_index].last_channel == note.channel {
                            AssignmentReason::ChannelContinuity
                        } else {
                            AssignmentReason::ClosestPitch
                        };
                        (confidence, reason)
                    }
                }
            }
        };

        let state_index = match existing {
            Some(state_index) => state_index,
            None => {
                let next_index = states.len();
                states.push(VoiceState {
                    id: voice_id.clone(),
                    last_end_tick: 0,
                    last_pitch: notes[index].pitch,
                    last_channel: notes[index].channel,
                    note_count: 0,
                    lowest_pitch: notes[index].pitch,
                    highest_pitch: notes[index].pitch,
                });
                state_index_by_id.insert(voice_id, next_index);
                next_index
            }
        };

        let note = &mut notes[index];
        note.assignment_confidence = confidence;
        note.assignment_reason = reason;
        let state = &mut states[state_index];
        state.last_end_tick = state.last_end_tick.max(note.end_tick);
        state.last_pitch = note.pitch;
        state.last_channel = note.channel;
        state.note_count += 1;
        state.lowest_pitch = state.lowest_pitch.min(note.pitch);
        state.highest_pitch = state.highest_pitch.max(note.pitch);
    }
}

/// Contig-mapping voice separation (after Chew & Wu 2004), adapted to this
/// codebase's cost model. The piece is segmented into contigs (spans of
/// constant polyphony) where voice-leading is unambiguous, so mistakes can
/// only happen at contig boundaries -- unlike the note-at-a-time modes,
/// which can go wrong on any note. At each boundary, fragments are matched
/// to *all* resting chains (not just the previous contig's), so a voice
/// that rests through a solo passage keeps its identity when it re-enters.
///
/// Deviations from the paper, on purpose:
/// - In-contig successions match same-channel replacements first (see
///   `match_succession`); the paper's pitch-order-only matching was built
///   for channel-less symbolic data and measurably mixes instruments on
///   files where each instrument owns a MIDI channel.
/// - Boundaries are connected left-to-right against accumulated chain state
///   (register envelope, last pitch/channel) rather than outward from
///   maximal-voice contigs; the accumulated state carries the context the
///   paper's ordering exists to protect.
/// - `max_voice_count` (not a concept in the paper) mirrors greedy's
///   documented trade-off: once at the cap, an unmatched fragment is forced
///   into the cheapest existing chain and its notes surface as
///   `VoiceCapReached` in review mode. When more fragments need new chains
///   than the cap allows, the lowest-pitched fragments keep the new-chain
///   slots (deterministic, and the forced ones are flagged regardless).
/// - Locks: a chain containing locked notes claims that locked voice id
///   (majority wins, first-encountered on a tie), so a correction pulls its
///   whole fragment chain into the corrected voice; every locked note is
///   additionally pinned to its exact locked id afterwards as a hard
///   per-note guarantee, and locked ids are never handed to other chains.
pub fn assign_contig_voices_with_locks(
    notes: &mut [MidiNoteDto],
    locked: &HashMap<String, String>,
    max_voice_count: Option<usize>,
    strategy: SeparationStrategy,
) -> Vec<MidiVoiceDto> {
    let weights = strategy.cost_weights();
    let contigs = build_contigs(notes);
    let mut chains: Vec<ChainBuild> = Vec::new();
    let mut chain_of_note: HashMap<usize, usize> = HashMap::new();

    for contig in &contigs {
        let fresh_fragments: Vec<usize> = contig
            .fragments
            .iter()
            .enumerate()
            .filter(|(_, fragment)| !fragment.held_seed)
            .map(|(fragment_index, _)| fragment_index)
            .collect();

        // Chains resting at this boundary, pitch-ordered for the
        // non-crossing alignment. Chains held into this contig are excluded
        // automatically: their held note ends after the contig starts.
        let mut available: Vec<usize> = (0..chains.len())
            .filter(|&chain_index| chains[chain_index].state.last_end_tick <= contig.start_tick)
            .collect();
        available.sort_by_key(|&chain_index| (chains[chain_index].state.last_pitch, chain_index));

        let alignment = align_fragments_to_chains(
            notes,
            &chains,
            &available,
            contig,
            &fresh_fragments,
            &weights,
        );

        let mut new_chain_budget = match max_voice_count {
            Some(max) => max.saturating_sub(chains.len()),
            None => usize::MAX,
        };
        if chains.is_empty() {
            // Same rule as the other modes' voice cap: even a cap of 0 must
            // allow the very first voice, since leaving a note unassigned
            // isn't a valid outcome.
            new_chain_budget = new_chain_budget.max(1);
        }

        let mut alignment_by_fragment: HashMap<usize, Option<usize>> = HashMap::new();
        for (position, &fragment_index) in fresh_fragments.iter().enumerate() {
            alignment_by_fragment.insert(fragment_index, alignment[position]);
        }

        for (fragment_index, fragment) in contig.fragments.iter().enumerate() {
            let chain_index = if fragment.held_seed {
                chain_of_note[&fragment.note_indices[0]]
            } else {
                match alignment_by_fragment[&fragment_index] {
                    Some(matched_chain) => matched_chain,
                    None if new_chain_budget > 0 => {
                        new_chain_budget -= 1;
                        create_chain(&mut chains, &notes[fragment.note_indices[0]])
                    }
                    None => {
                        // At the cap with no compatible chain: force the
                        // cheapest existing chain, mirroring greedy's
                        // at-the-cap behavior. The replay pass will flag
                        // the overlapping notes as `VoiceCapReached`.
                        let first_note = &notes[fragment.note_indices[0]];
                        let chain_states: Vec<VoiceState> =
                            chains.iter().map(|chain| chain.state.clone()).collect();
                        score_candidates(&chain_states, first_note, false, &weights)
                            .into_iter()
                            .min_by(|left, right| {
                                left.cost
                                    .partial_cmp(&right.cost)
                                    .unwrap_or(Ordering::Equal)
                                    .then(left.index.cmp(&right.index))
                            })
                            .expect("the first fragment always opens a chain, so chains is non-empty here")
                            .index
                    }
                }
            };

            let committed_from = usize::from(fragment.held_seed);
            for &note_index in &fragment.note_indices[committed_from..] {
                chain_of_note.insert(note_index, chain_index);
                append_note_to_chain(&mut chains[chain_index], note_index, &notes[note_index]);
            }
        }
    }

    debug_assert_eq!(
        chain_of_note.len(),
        notes.len(),
        "every note must be committed to exactly one chain"
    );

    // Assign voice ids in chain-creation order (which follows the time
    // order of each chain's first note).
    let reserved_voice_ids: HashSet<&str> = locked.values().map(String::as_str).collect();
    let mut used_ids: HashMap<String, usize> = HashMap::new();
    let mut chain_ids: Vec<String> = Vec::with_capacity(chains.len());
    for chain in &chains {
        // Locked ids referenced by this chain's notes, counted in
        // first-encountered order so a tie deterministically goes to the
        // earliest correction.
        let mut locked_id_counts: Vec<(&str, usize)> = Vec::new();
        for &note_index in &chain.note_indices {
            if let Some(locked_id) = locked.get(&notes[note_index].id) {
                match locked_id_counts
                    .iter_mut()
                    .find(|(id, _)| *id == locked_id.as_str())
                {
                    Some(entry) => entry.1 += 1,
                    None => locked_id_counts.push((locked_id.as_str(), 1)),
                }
            }
        }
        let claim = locked_id_counts
            .iter()
            .map(|&(_, count)| count)
            .max()
            .and_then(|max_count| {
                locked_id_counts
                    .iter()
                    .find(|&&(_, count)| count == max_count)
                    .map(|&(id, _)| id)
            });
        let chain_id = match claim {
            Some(id) if !used_ids.contains_key(id) => id.to_string(),
            _ => allocate_new_voice_id(&used_ids, &reserved_voice_ids),
        };
        used_ids.insert(chain_id.clone(), chain_ids.len());
        chain_ids.push(chain_id);
    }

    for (chain_index, chain) in chains.iter().enumerate() {
        for &note_index in &chain.note_indices {
            notes[note_index]
                .voice_id
                .clone_from(&chain_ids[chain_index]);
        }
    }
    // Hard per-note lock guarantee, regardless of which chain the note's
    // fragment landed in.
    for note in notes.iter_mut() {
        if let Some(locked_id) = locked.get(&note.id) {
            note.voice_id.clone_from(locked_id);
        }
    }

    replay_assignment_reporting(notes, locked, &weights);
    summarize_assigned_voices(notes)
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
                role: if voice_id == PERCUSSION_VOICE_ID
                    || voice_notes
                        .iter()
                        .all(|note| note.channel == PERCUSSION_CHANNEL)
                {
                    VoiceRoleDto::Percussion
                } else {
                    VoiceRoleDto::Melodic
                },
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
///
/// The crossing term scores each candidate against the *whole* `voices`
/// slice (a candidate crosses voices it can't itself join), so callers
/// that need one specific voice's cost must pass the full slice and pick
/// their candidate out of the result rather than scoring a single-voice
/// slice — a `std::slice::from_ref` call here silently computes a cost
/// with no crossing context.
fn score_candidates(
    voices: &[VoiceState],
    note: &MidiNoteDto,
    require_compatible: bool,
    weights: &CostWeights,
) -> Vec<Candidate> {
    // Pitches of voices still sounding at this note's start, sorted so
    // each candidate's crossing count is two binary searches instead of a
    // rescan of every voice. A candidate's own pitch can never be counted
    // against it: it is always an endpoint of the strict-inequality range.
    let mut sounding_pitches: Vec<u8> = if weights.crossing_weight > 0.0 {
        voices
            .iter()
            .filter(|voice| voice.last_end_tick > note.start_tick)
            .map(|voice| voice.last_pitch)
            .collect()
    } else {
        Vec::new()
    };
    sounding_pitches.sort_unstable();

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
            let crossing_count = if sounding_pitches.is_empty() {
                0
            } else {
                let low = voice.last_pitch.min(note.pitch);
                let high = voice.last_pitch.max(note.pitch);
                let from = sounding_pitches.partition_point(|&pitch| pitch <= low);
                let to = sounding_pitches.partition_point(|&pitch| pitch < high);
                // `to < from` when the note repeats the voice's last pitch
                // (an empty strict range crosses nothing).
                to.saturating_sub(from)
            };
            Candidate {
                index,
                cost: pitch_distance
                    + register_distance * weights.register_drift_weight
                    + normalized_gap * weights.gap_weight
                    + crossing_count as f32 * weights.crossing_weight
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
    fn crossing_penalty_avoids_leaping_over_a_sounding_voice() {
        // Two resting candidates for the pitch-65 note "t": voice-a last
        // at 61 (distance 4, no crossing) and voice-b last at 68 (distance
        // 3, but reaching down to 65 leaps over voice-c, still sounding at
        // 66). Raw pitch distance alone picks voice-b; the crossing term
        // makes leaping over the sounding voice cost more than the one
        // extra semitone, flipping the choice to voice-a. All notes share
        // a channel and every voice has a single note (so the channel and
        // register terms cancel out of the comparison).
        let mut notes = vec![
            note("a1", 61, 0, 200),
            note("b1", 68, 0, 200),
            note("c1", 66, 100, 400),
            note("t", 65, 200, 300),
        ];
        let locked = HashMap::from([
            ("a1".to_string(), "voice-a".to_string()),
            ("b1".to_string(), "voice-b".to_string()),
            ("c1".to_string(), "voice-c".to_string()),
        ]);

        assign_heuristic_voices_with_locks(&mut notes, &locked, None, SeparationStrategy::Balanced);

        assert_eq!(notes[3].voice_id, "voice-a");
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

    /// Same adversarial pattern as the test above, but with 3 unrelated
    /// filler notes (a distant pitch/channel that's never competitive)
    /// prepended so `seed-a2` -- the note whose decision needs to see
    /// several notes ahead to get right -- lands exactly on what used to
    /// be a fixed chunk boundary (`LOOKAHEAD_WINDOW` = 6, so the old
    /// chunked design would have solved indices 0..6 as one closed group
    /// and 6..12 as the next, deciding `seed-a2` -- at index 5 -- using
    /// only the filler notes and `seed-a1`/`seed-b1`, never seeing
    /// `seed-b2` or any `free-*` note). A fixed-chunk implementation would
    /// fail this the same way greedy does, since it's given the same
    /// blind information at the point of deciding `seed-a2`; the sliding
    /// window instead re-solves a moving 6-note view on every note, so
    /// `seed-a2` is only finalized once the search has already seen
    /// `seed-b2` and the first couple of `free-*` notes, regardless of
    /// where it happens to fall in the sequence.
    #[test]
    fn finds_the_pitch_register_split_even_when_the_pivot_lands_on_the_old_chunk_boundary() {
        let mut notes = vec![
            mk("filler-0", 9, 20, 0, 50),
            mk("filler-1", 9, 20, 60, 110),
            mk("filler-2", 9, 20, 120, 170),
            mk("seed-a1", 0, 49, 200, 400),
            mk("seed-b1", 1, 65, 200, 400),
            mk("seed-a2", 0, 64, 400, 600),
            mk("seed-b2", 1, 68, 400, 600),
            mk("free-0", 0, 71, 620, 687),
            mk("free-1", 1, 78, 697, 805),
            mk("free-2", 0, 48, 816, 882),
            mk("free-3", 0, 44, 890, 1001),
            mk("free-4", 0, 75, 1024, 1177),
        ];

        assign_windowed_voices_with_locks(
            &mut notes,
            &HashMap::new(),
            None,
            SeparationStrategy::Balanced,
        );

        assert_eq!(
            notes[3].voice_id, notes[5].voice_id,
            "seed-a1 and seed-a2 should land in the same voice even though seed-a2 sits where \
             a fixed chunk boundary used to fall"
        );
        assert_eq!(
            notes[4].voice_id, notes[6].voice_id,
            "seed-b1 and seed-b2 should land in the same voice"
        );
        assert_ne!(notes[3].voice_id, notes[4].voice_id);
    }

    /// Replays a committed assignment's real note->voice_id mapping through
    /// the same cost formula used to produce it, giving the actual total
    /// cost being minimized -- unlike `assignment_confidence`, which
    /// measures how locally decisive a single pick was, not whether the
    /// overall grouping is cheaper.
    fn total_cost_of_committed_assignment(notes: &[MidiNoteDto], weights: &CostWeights) -> f32 {
        // Index-aligned states (not a HashMap) so each note's cost can be
        // scored against the full slice -- the crossing term needs the
        // other voices as context, not just the note's own voice.
        let mut states: Vec<VoiceState> = Vec::new();
        let mut state_index_by_id: HashMap<String, usize> = HashMap::new();
        let mut total = 0.0f32;

        for note in notes {
            let state_index = match state_index_by_id.get(&note.voice_id).copied() {
                Some(state_index) => {
                    total += score_candidates(&states, note, false, weights)[state_index].cost;
                    state_index
                }
                None => {
                    let next_index = states.len();
                    state_index_by_id.insert(note.voice_id.clone(), next_index);
                    states.push(VoiceState {
                        id: note.voice_id.clone(),
                        last_end_tick: note.end_tick,
                        last_pitch: note.pitch,
                        last_channel: note.channel,
                        note_count: 0,
                        lowest_pitch: note.pitch,
                        highest_pitch: note.pitch,
                    });
                    next_index
                }
            };

            let voice = &mut states[state_index];
            voice.last_end_tick = voice.last_end_tick.max(note.end_tick);
            voice.last_pitch = note.pitch;
            voice.last_channel = note.channel;
            voice.note_count += 1;
            voice.lowest_pitch = voice.lowest_pitch.min(note.pitch);
            voice.highest_pitch = voice.highest_pitch.max(note.pitch);
        }

        total
    }

    /// Shared by the real-fixture regression tests below: confirms
    /// `Global` doesn't just work on the constructed adversarial cases
    /// above, but actually finds an equal-or-lower-cost partition than
    /// `Greedy` on real music, across every strategy. See
    /// `fixtures/README.md` for each fixture's provenance/license and why
    /// it was chosen.
    fn assert_global_matches_or_beats_greedy_cost_on_fixture(fixture_file_name: &str) {
        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("fixtures")
            .join(fixture_file_name);
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
                "{fixture_file_name} / {strategy:?}: Global cost {global_cost} should be <= \
                 Greedy cost {greedy_cost}"
            );
        }
    }

    #[test]
    fn global_mode_matches_or_beats_greedy_cost_on_a_real_combined_fixture() {
        assert_global_matches_or_beats_greedy_cost_on_fixture("boss-battle-6-combined.mid");
    }

    #[test]
    fn global_mode_matches_or_beats_greedy_cost_on_a_real_separate_tracks_fixture() {
        assert_global_matches_or_beats_greedy_cost_on_fixture("boss-battle-6-separate-tracks.mid");
    }
}

#[cfg(test)]
mod contig_tests {
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
            duration_ticks: end_tick.saturating_sub(start_tick),
            assignment_confidence: 0.0,
            assignment_reason: AssignmentReason::ClosestPitch,
        }
    }

    #[test]
    fn reuses_a_compatible_voice_like_greedy_does() {
        let mut notes = vec![mk("a", 0, 60, 0, 120), mk("b", 0, 62, 120, 240)];

        let voices = assign_contig_voices_with_locks(
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

        let voices = assign_contig_voices_with_locks(
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

        assign_contig_voices_with_locks(
            &mut first,
            &HashMap::new(),
            None,
            SeparationStrategy::Balanced,
        );
        assign_contig_voices_with_locks(
            &mut second,
            &HashMap::new(),
            None,
            SeparationStrategy::Balanced,
        );

        let first_assignments: Vec<_> = first.iter().map(|note| note.voice_id.clone()).collect();
        let second_assignments: Vec<_> = second.iter().map(|note| note.voice_id.clone()).collect();
        assert_eq!(first_assignments, second_assignments);
    }

    /// The mechanism the whole mode is built on: at a tick where the
    /// polyphony count stays constant but the sounding notes are replaced,
    /// departures are matched to arrivals by pitch order, so the low line
    /// stays the low line and the high line stays the high line.
    #[test]
    fn within_contig_succession_follows_pitch_order() {
        let mut notes = vec![
            mk("low-1", 0, 60, 0, 100),
            mk("high-1", 0, 70, 0, 100),
            mk("low-2", 0, 58, 100, 200),
            mk("high-2", 0, 72, 100, 200),
        ];

        assign_contig_voices_with_locks(
            &mut notes,
            &HashMap::new(),
            None,
            SeparationStrategy::Balanced,
        );

        assert_eq!(notes[0].voice_id, notes[2].voice_id);
        assert_eq!(notes[1].voice_id, notes[3].voice_id);
        assert_ne!(notes[0].voice_id, notes[1].voice_id);
    }

    /// A same-tick replacement on the same channel is the same instrument
    /// continuing, even when plain pitch-order matching would pair the
    /// lines the other way around (here the channel-0 line leaps from 60
    /// up to 72 while the channel-1 line dives from 70 down to 58 --
    /// pitch order alone would swap them).
    #[test]
    fn within_contig_succession_prefers_same_channel_over_pitch_order() {
        let mut notes = vec![
            mk("a1", 0, 60, 0, 100),
            mk("b1", 1, 70, 0, 100),
            mk("b2", 1, 58, 100, 200),
            mk("a2", 0, 72, 100, 200),
        ];

        assign_contig_voices_with_locks(
            &mut notes,
            &HashMap::new(),
            None,
            SeparationStrategy::Balanced,
        );

        assert_eq!(
            notes[0].voice_id, notes[3].voice_id,
            "the channel-0 line should continue on channel 0"
        );
        assert_eq!(
            notes[1].voice_id, notes[2].voice_id,
            "the channel-1 line should continue on channel 1"
        );
        assert_ne!(notes[0].voice_id, notes[1].voice_id);
    }

    /// The adversarial fixture greedy provably gets wrong (see
    /// `windowed_tests::finds_the_pitch_register_split_that_greedy_misses`):
    /// here the whole seed section is one contig (the replacement at tick
    /// 200 keeps the count at 2), so pitch-ordered succession pairs the
    /// lines correctly without any search at all -- the case that needed a
    /// 6-note lookahead under the note-at-a-time family is structurally
    /// unambiguous under the contig family.
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

        assign_contig_voices_with_locks(
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

    /// The structural advantage over connecting only *adjacent* contigs:
    /// boundary matching considers every resting chain, so a voice that
    /// rests through a solo passage keeps its identity when it re-enters
    /// instead of being reborn as a new voice.
    #[test]
    fn a_resting_chain_reconnects_after_a_solo_passage() {
        let mut notes = vec![
            mk("low-1", 0, 40, 0, 200),
            mk("high-1", 0, 72, 0, 200),
            mk("low-2", 0, 40, 200, 400),
            mk("high-2", 0, 72, 200, 400),
            // Solo passage: only the high line continues.
            mk("solo", 0, 74, 400, 800),
            // Both lines re-enter after a rest.
            mk("low-3", 0, 41, 900, 1100),
            mk("high-3", 0, 73, 900, 1100),
        ];

        let voices = assign_contig_voices_with_locks(
            &mut notes,
            &HashMap::new(),
            None,
            SeparationStrategy::Balanced,
        );

        assert_eq!(voices.len(), 2);
        assert_eq!(
            notes[5].voice_id, notes[0].voice_id,
            "the re-entering low line should reconnect to the rested low chain"
        );
        assert_eq!(
            notes[6].voice_id, notes[1].voice_id,
            "the re-entering high line should continue the high chain"
        );
    }

    #[test]
    fn locked_note_stays_pinned_and_pulls_its_fragment_chain() {
        let mut notes = vec![
            mk("a", 0, 60, 0, 120),
            mk("b", 0, 70, 0, 120),
            mk("c", 0, 66, 120, 240),
        ];
        let locked = HashMap::from([("b".to_string(), "voice-9".to_string())]);

        assign_contig_voices_with_locks(&mut notes, &locked, None, SeparationStrategy::Balanced);

        assert_eq!(notes[1].voice_id, "voice-9");
        assert_eq!(notes[1].assignment_reason, AssignmentReason::UserLocked);
        assert_eq!(notes[1].assignment_confidence, 1.0);
        // "a" must not collide with the reserved locked id.
        assert_eq!(notes[0].voice_id, "voice-1");
        // "c" is closer in pitch to the locked voice's line (70) than to
        // "a"'s (60), so the boundary matching pulls it into the corrected
        // voice, same as greedy's cost model would.
        assert_eq!(notes[2].voice_id, "voice-9");
    }

    #[test]
    fn voice_cap_forces_reuse_instead_of_opening_a_new_voice() {
        let mut notes = vec![mk("a", 0, 60, 0, 240), mk("b", 0, 64, 120, 360)];

        assign_contig_voices_with_locks(
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

        let voices = assign_contig_voices_with_locks(
            &mut notes,
            &HashMap::new(),
            Some(0),
            SeparationStrategy::Balanced,
        );

        assert_eq!(voices.len(), 1);
        assert_eq!(notes[0].assignment_reason, AssignmentReason::NewVoiceNoFit);
    }

    #[test]
    fn voice_cap_does_not_block_locked_notes() {
        let mut notes = vec![
            mk("a", 0, 60, 0, 240),
            mk("b", 0, 64, 0, 240),
            mk("c", 0, 68, 0, 240),
        ];
        let locked = HashMap::from([
            ("a".to_string(), "voice-1".to_string()),
            ("b".to_string(), "voice-2".to_string()),
            ("c".to_string(), "voice-3".to_string()),
        ]);

        assign_contig_voices_with_locks(&mut notes, &locked, Some(1), SeparationStrategy::Balanced);

        assert_eq!(notes[0].voice_id, "voice-1");
        assert_eq!(notes[1].voice_id, "voice-2");
        assert_eq!(notes[2].voice_id, "voice-3");
    }

    #[test]
    fn zero_length_notes_still_get_assigned() {
        let mut notes = vec![mk("a", 0, 60, 0, 120), mk("zero", 0, 62, 120, 120)];

        assign_contig_voices_with_locks(
            &mut notes,
            &HashMap::new(),
            None,
            SeparationStrategy::Balanced,
        );

        assert!(!notes[1].voice_id.is_empty());
    }

    /// Smoke test against both real fixtures: every note gets a voice, the
    /// summary is consistent with the notes, and the whole run is
    /// deterministic -- across all four strategies.
    #[test]
    fn assigns_every_note_deterministically_on_real_fixtures() {
        for fixture_file_name in [
            "boss-battle-6-combined.mid",
            "boss-battle-6-separate-tracks.mid",
        ] {
            let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("..")
                .join("fixtures")
                .join(fixture_file_name);
            let bytes = std::fs::read(&path).expect("fixture should be readable");
            let project = super::super::parser::parse_midi_project(&path, &bytes)
                .expect("fixture should parse");

            for strategy in [
                SeparationStrategy::Balanced,
                SeparationStrategy::ChannelPriority,
                SeparationStrategy::RegisterPriority,
                SeparationStrategy::StrictChannel,
            ] {
                let mut first = project.notes.clone();
                let voices =
                    assign_contig_voices_with_locks(&mut first, &HashMap::new(), None, strategy);

                assert!(
                    first.iter().all(|note| !note.voice_id.is_empty()),
                    "{fixture_file_name} / {strategy:?}: every note should have a voice"
                );
                let distinct: HashSet<&str> =
                    first.iter().map(|note| note.voice_id.as_str()).collect();
                assert_eq!(
                    voices.len(),
                    distinct.len(),
                    "{fixture_file_name} / {strategy:?}: summary should match the notes"
                );

                let mut second = project.notes.clone();
                assign_contig_voices_with_locks(&mut second, &HashMap::new(), None, strategy);
                let first_ids: Vec<_> = first.iter().map(|note| note.voice_id.clone()).collect();
                let second_ids: Vec<_> = second.iter().map(|note| note.voice_id.clone()).collect();
                assert_eq!(
                    first_ids, second_ids,
                    "{fixture_file_name} / {strategy:?}: assignment should be deterministic"
                );
            }
        }
    }
}

#[cfg(test)]
mod percussion_tests {
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
            duration_ticks: end_tick.saturating_sub(start_tick),
            assignment_confidence: 0.0,
            assignment_reason: AssignmentReason::ClosestPitch,
        }
    }

    #[test]
    fn routes_channel_ten_notes_to_the_percussion_voice_in_every_mode() {
        for mode in [
            AssignmentMode::Greedy,
            AssignmentMode::Global,
            AssignmentMode::Contig,
        ] {
            let mut notes = vec![
                mk("kick", PERCUSSION_CHANNEL, 36, 0, 120),
                mk("melody-1", 0, 60, 0, 120),
                mk("hihat", PERCUSSION_CHANNEL, 42, 60, 180),
                mk("melody-2", 0, 62, 120, 240),
            ];

            let voices = assign_voices_with_locks(
                &mut notes,
                &HashMap::new(),
                None,
                SeparationStrategy::Balanced,
                mode,
            );

            assert_eq!(notes[0].voice_id, PERCUSSION_VOICE_ID, "{mode:?}");
            assert_eq!(notes[2].voice_id, PERCUSSION_VOICE_ID, "{mode:?}");
            assert_eq!(notes[0].assignment_reason, AssignmentReason::Percussion);
            assert_eq!(notes[0].assignment_confidence, 1.0);
            // The two melody notes are sequential and should share one
            // pitched voice untouched by the drums.
            assert_eq!(notes[1].voice_id, notes[3].voice_id, "{mode:?}");
            assert_ne!(notes[1].voice_id, PERCUSSION_VOICE_ID, "{mode:?}");

            let percussion_voice = voices
                .iter()
                .find(|voice| voice.id == PERCUSSION_VOICE_ID)
                .expect("percussion voice should be listed");
            assert_eq!(percussion_voice.label, "Percussion");
            assert_eq!(percussion_voice.role, VoiceRoleDto::Percussion);
            assert_eq!(percussion_voice.note_count, 2);
            assert_eq!(percussion_voice.lowest_pitch, 36);
            assert_eq!(percussion_voice.highest_pitch, 42);
        }
    }

    /// The failure mode that motivated percussion isolation: a drum note's
    /// "pitch" (a GM drum identity) sitting numerically near a bass line
    /// used to attract the bass's next note into the drum voice.
    #[test]
    fn a_drum_note_no_longer_attracts_the_bass_line() {
        let mut notes = vec![
            mk("bass-1", 0, 40, 0, 100),
            mk("kick", PERCUSSION_CHANNEL, 36, 0, 100),
            mk("bass-2", 0, 36, 100, 200),
        ];

        assign_voices_with_locks(
            &mut notes,
            &HashMap::new(),
            None,
            SeparationStrategy::Balanced,
            AssignmentMode::Greedy,
        );

        assert_eq!(
            notes[2].voice_id, notes[0].voice_id,
            "the pitch-36 bass note should continue the bass voice, not follow the pitch-36 kick"
        );
        assert_eq!(notes[1].voice_id, PERCUSSION_VOICE_ID);
    }

    #[test]
    fn a_locked_percussion_note_follows_its_lock() {
        let mut notes = vec![
            mk("kick", PERCUSSION_CHANNEL, 36, 0, 120),
            mk("snare", PERCUSSION_CHANNEL, 38, 60, 180),
        ];
        let locked = HashMap::from([("kick".to_string(), "voice-5".to_string())]);

        assign_voices_with_locks(
            &mut notes,
            &locked,
            None,
            SeparationStrategy::Balanced,
            AssignmentMode::Greedy,
        );

        assert_eq!(notes[0].voice_id, "voice-5");
        assert_eq!(notes[0].assignment_reason, AssignmentReason::UserLocked);
        assert_eq!(notes[1].voice_id, PERCUSSION_VOICE_ID);
    }

    #[test]
    fn percussion_voice_sits_outside_the_voice_cap() {
        let mut notes = vec![
            mk("melody", 0, 60, 0, 120),
            mk("kick", PERCUSSION_CHANNEL, 36, 0, 120),
            mk("snare", PERCUSSION_CHANNEL, 38, 60, 180),
        ];

        let voices = assign_voices_with_locks(
            &mut notes,
            &HashMap::new(),
            Some(1),
            SeparationStrategy::Balanced,
            AssignmentMode::Greedy,
        );

        // The cap of 1 constrains the pitched notes only; percussion still
        // gets its dedicated voice on top.
        assert_eq!(voices.len(), 2);
        assert_eq!(notes[1].voice_id, PERCUSSION_VOICE_ID);
        assert_eq!(notes[2].voice_id, PERCUSSION_VOICE_ID);
        assert_ne!(notes[0].voice_id, PERCUSSION_VOICE_ID);
    }

    #[test]
    fn a_pitched_note_locked_into_the_percussion_voice_merges_into_one_listing() {
        let mut notes = vec![
            mk("kick", PERCUSSION_CHANNEL, 36, 0, 120),
            mk("melody", 0, 60, 0, 120),
        ];
        let locked = HashMap::from([("melody".to_string(), PERCUSSION_VOICE_ID.to_string())]);

        let voices = assign_voices_with_locks(
            &mut notes,
            &locked,
            None,
            SeparationStrategy::Balanced,
            AssignmentMode::Greedy,
        );

        let percussion_listings = voices
            .iter()
            .filter(|voice| voice.id == PERCUSSION_VOICE_ID)
            .count();
        assert_eq!(percussion_listings, 1);
        let percussion_voice = voices
            .iter()
            .find(|voice| voice.id == PERCUSSION_VOICE_ID)
            .expect("percussion voice should be listed");
        assert_eq!(percussion_voice.note_count, 2);
    }
}
