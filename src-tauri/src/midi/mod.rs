pub mod assignment_metric;
pub mod exporter;
pub mod model;
pub mod parser;
pub mod voice_assignment;

pub use model::{ExportMidiResultDto, MidiProjectDto};

/// Legacy marker: exports used to write this as every voice track's name,
/// and the parser detected app-exported files by it. Kept so files
/// exported before real voice labels became the track names still
/// round-trip with their voice structure preserved.
pub const EXPORTED_VOICE_TRACK_NAME: &[u8] = b"Chiptune Voice Separator Voice";
/// Current marker: a `Text` meta event written alongside each voice
/// track's real (label-derived) track name, so app-exported files stay
/// detectable without sacrificing the track name to a fixed sentinel.
pub const EXPORTED_VOICE_TRACK_MARKER: &[u8] = b"chiptune-voice-separator:voice-track";
