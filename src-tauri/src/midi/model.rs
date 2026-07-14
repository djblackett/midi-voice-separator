use serde::{Deserialize, Serialize};

/// Bump when a change can alter the heuristic-produced base assignment.
pub const ASSIGNMENT_ALGORITHM_VERSION: u32 = 1;

/// Backend-minted record of how a document's base assignment was produced.
/// Manual corrections are deliberately not represented here; they remain in
/// the editor's override layer.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AssignmentProvenanceDto {
    Imported {
        #[serde(rename = "algorithmVersion")]
        algorithm_version: u32,
    },
    AppExportedVoiceTracks,
    Reassigned {
        strategy: SeparationStrategy,
        mode: AssignmentMode,
        #[serde(rename = "maxVoiceCount")]
        max_voice_count: Option<usize>,
        #[serde(rename = "algorithmVersion")]
        algorithm_version: u32,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentOperationResultDto {
    pub project: MidiProjectDto,
    pub provenance: AssignmentProvenanceDto,
}

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
    pub strategy_suggestion: StrategySuggestionDto,
}

/// Which `SeparationStrategy` the import analysis recommends for this
/// file, with a human-readable reason — computed once at parse time from
/// the melodic channel distribution (see `suggest_strategy` in
/// `parser.rs`). The frontend preselects the strategy dropdown with it and
/// shows the reason, but the user stays free to override.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StrategySuggestionDto {
    pub strategy: SeparationStrategy,
    pub reason: String,
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
    /// Channel-10 percussion: GM drum "pitches" are drum identities (36 =
    /// kick, 42 = closed hihat), not pitches, so these notes are routed to
    /// a dedicated percussion voice instead of ever entering the
    /// pitch/register cost model.
    Percussion,
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
/// `assign_windowed_voices_with_locks` in `voice_assignment.rs`. `Contig`
/// is a different algorithm family entirely (Chew & Wu's contig-mapping
/// approach): it segments the piece into spans of constant polyphony,
/// where voice-leading is unambiguous, and only makes real decisions at
/// the span boundaries -- see `assign_contig_voices_with_locks`.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AssignmentMode {
    Greedy,
    Global,
    Contig,
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

/// Versioned policy echoed by a note-correspondence response. The matching
/// implementation remains private to the backend; this is its stable wire
/// identity for the first real Feature 8 consumer.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum NoteMatchPolicyDto {
    SameDocumentV1,
    StrictRoundTripV1,
    CrossImportV1,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CrossImportIncomparableReasonDto {
    DifferentDocumentIds,
    InsufficientCoverage,
}

/// Side-qualified parser-local note address. It is intentionally an address,
/// not a content identity claim.
#[derive(Debug, Clone, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub struct NoteRefDto {
    pub document_id: String,
    pub note_id: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CrossImportNotePairDto {
    pub reference: NoteRefDto,
    pub editable: NoteRefDto,
}

/// JSON numbers cannot faithfully represent every u128 score component, so
/// the reduced rational values cross the boundary as decimal strings.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RationalQuarterDistanceDto {
    pub numerator: String,
    pub denominator: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CrossImportFuzzyNotePairDto {
    pub reference: NoteRefDto,
    pub editable: NoteRefDto,
    pub onset_distance: RationalQuarterDistanceDto,
    pub duration_distance: RationalQuarterDistanceDto,
    pub same_channel: bool,
    pub velocity_difference: u8,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AmbiguousNoteMatchKindDto {
    DuplicateExact,
    FuzzyConflict,
}

/// An ambiguity group preserves every eligible side-qualified reference; no
/// consumer may derive occurrence-order pairs from it.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AmbiguousNoteMatchGroupDto {
    pub kind: AmbiguousNoteMatchKindDto,
    pub reference: Vec<NoteRefDto>,
    pub editable: Vec<NoteRefDto>,
    pub matched_multiplicity: usize,
    pub candidate_count: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CrossImportMatchCoverageDto {
    pub total: usize,
    pub exact: usize,
    pub fuzzy: usize,
    pub ambiguous: usize,
    pub unmatched: usize,
}

/// Serializable read-only result for the Feature 8 comparison command. The
/// command is introduced later; defining this DTO beside the other Tauri
/// models keeps the pure matcher itself free of wire-format concerns.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CrossImportMatchResultDto {
    pub matcher_version: u32,
    pub policy: NoteMatchPolicyDto,
    pub comparable: bool,
    pub incomparable_reason: Option<CrossImportIncomparableReasonDto>,
    pub reference_coverage: CrossImportMatchCoverageDto,
    pub editable_coverage: CrossImportMatchCoverageDto,
    pub exact_pairs: Vec<CrossImportNotePairDto>,
    pub fuzzy_pairs: Vec<CrossImportFuzzyNotePairDto>,
    pub ambiguous: Vec<AmbiguousNoteMatchGroupDto>,
    pub unmatched_reference: Vec<NoteRefDto>,
    pub unmatched_editable: Vec<NoteRefDto>,
}

/// Materialized editable document supplied by the frontend for a read-only
/// external comparison. Editor history and overrides stay in TypeScript; Rust
/// receives only the project state that is currently displayed/exported.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MatchDocumentRequestDto {
    pub document_id: String,
    pub project: MidiProjectDto,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CrossImportComparisonRequestDto {
    pub reference_path: String,
    pub reference_document_id: String,
    pub editable: MatchDocumentRequestDto,
}

/// A successfully parsed external MIDI file. This intentionally excludes all
/// editor mutation/history state, so it cannot become an editable branch.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceDocumentDto {
    pub document_id: String,
    pub path: String,
    pub project: MidiProjectDto,
    pub provenance: AssignmentProvenanceDto,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CrossImportComparisonResponseDto {
    pub reference: ReferenceDocumentDto,
    pub correspondence: CrossImportMatchResultDto,
}
