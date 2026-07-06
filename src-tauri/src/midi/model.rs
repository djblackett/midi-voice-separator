use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MidiProjectDto {
    pub file_name: String,
    pub format: String,
    pub ppq: u16,
    pub duration_ticks: u64,
    pub track_count: usize,
    pub voices: Vec<MidiVoiceDto>,
    pub notes: Vec<MidiNoteDto>,
    pub tempo_changes: Vec<TempoChangeDto>,
    pub time_signatures: Vec<TimeSignatureDto>,
    pub warnings: Vec<MidiWarningDto>,
    pub separation_summary: SeparationSummaryDto,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MidiNoteDto {
    pub id: String,
    pub voice_id: String,
    pub source_track_index: usize,
    pub channel: u8,
    pub pitch: u8,
    pub velocity: u8,
    pub start_tick: u64,
    pub end_tick: u64,
    pub duration_ticks: u64,
    pub assignment_confidence: f32,
    pub assignment_reason: AssignmentReason,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AssignmentReason {
    Imported,
    ChannelContinuity,
    ClosestPitch,
    NewVoiceNoFit,
    UserLocked,
    VoiceCapReached,
}

/// Selects which cost-model weighting "Re-run separation" scores unlocked
/// notes with. Different files respond differently — e.g. a file with
/// clean per-instrument MIDI channels separates well under
/// `ChannelPriority`/`StrictChannel`, while a dense single-channel
/// chiptune export needs `RegisterPriority` to avoid one voice drifting
/// across the entire pitch range. Exposed as a user-facing choice instead
/// of a single fixed weighting so a file can be tried against a few
/// options rather than chasing one "best" heuristic.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SeparationStrategy {
    Balanced,
    ChannelPriority,
    RegisterPriority,
    StrictChannel,
}

/// Selects which assignment algorithm scores/searches for a voice per
/// note -- orthogonal to `SeparationStrategy`, which only picks the cost
/// weighting either algorithm scores with. `Greedy` commits each note to
/// its single cheapest compatible voice, irrevocably, before the next note
/// is even known. `Global` buffers a short lookahead window of unlocked
/// notes and searches for the true minimum-cost grouping across that whole
/// window before committing any of them, which can find a better overall
/// split than greedy's note-at-a-time commitment allows -- see
/// `assign_windowed_voices_with_locks` in `voice_assignment.rs`.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AssignmentMode {
    Greedy,
    Global,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SeparationSummaryDto {
    pub mean_confidence: f32,
    pub low_confidence_note_count: usize,
    pub voice_count: usize,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MidiVoiceDto {
    pub id: String,
    pub label: String,
    pub note_count: usize,
    pub lowest_pitch: u8,
    pub highest_pitch: u8,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TempoChangeDto {
    pub tick: u64,
    pub microseconds_per_quarter: u32,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TimeSignatureDto {
    pub tick: u64,
    pub numerator: u8,
    pub denominator: u8,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MidiWarningDto {
    pub code: MidiWarningCode,
    pub message: String,
    pub track_index: Option<usize>,
    pub tick: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MidiWarningCode {
    UnmatchedNoteOff,
    DanglingNoteOn,
    ZeroLengthNote,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExportMidiResultDto {
    pub path: String,
    pub track_count: usize,
    pub note_count: usize,
}
