use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MidiProjectDto {
    pub file_name: String,
    pub format: String,
    pub ppq: u16,
    pub duration_ticks: u64,
    pub track_count: usize,
    pub notes: Vec<MidiNoteDto>,
    pub tempo_changes: Vec<TempoChangeDto>,
    pub time_signatures: Vec<TimeSignatureDto>,
    pub warnings: Vec<MidiWarningDto>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MidiNoteDto {
    pub id: String,
    pub source_track_index: usize,
    pub channel: u8,
    pub pitch: u8,
    pub velocity: u8,
    pub start_tick: u64,
    pub end_tick: u64,
    pub duration_ticks: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TempoChangeDto {
    pub tick: u64,
    pub microseconds_per_quarter: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TimeSignatureDto {
    pub tick: u64,
    pub numerator: u8,
    pub denominator: u8,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MidiWarningDto {
    pub code: MidiWarningCode,
    pub message: String,
    pub track_index: Option<usize>,
    pub tick: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MidiWarningCode {
    UnmatchedNoteOff,
    DanglingNoteOn,
    ZeroLengthNote,
}
