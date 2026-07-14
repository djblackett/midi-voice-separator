pub mod assignment_metric;
// A1 intentionally adds the pure canonicalization seam before a public
// matcher policy consumes it in A2; retain it crate-private until then.
#[allow(dead_code)]
pub(crate) mod content_matching;
pub(crate) mod export_validation;
pub mod exporter;
pub mod model;
pub mod parser;
#[allow(dead_code)]
pub(crate) mod round_trip_verification;
pub mod voice_assignment;

pub use model::{AssignmentOperationResultDto, ExportMidiResultDto, MidiProjectDto};

/// Legacy marker: exports used to write this as every voice track's name,
/// and the parser detected app-exported files by it. Kept so files
/// exported before real voice labels became the track names still
/// round-trip with their voice structure preserved.
pub const EXPORTED_VOICE_TRACK_NAME: &[u8] = b"Chiptune Voice Separator Voice";
/// Current marker: a `Text` meta event written alongside each voice
/// track's real (label-derived) track name, so app-exported files stay
/// detectable without sacrificing the track name to a fixed sentinel.
pub const EXPORTED_VOICE_TRACK_MARKER: &[u8] = b"chiptune-voice-separator:voice-track";
/// Versioned semantic-role markers written beside the generic app-export
/// marker. They let an empty marked track retain its role on reimport.
pub const EXPORTED_VOICE_ROLE_MELODIC_MARKER: &[u8] =
    b"chiptune-voice-separator:voice-role-v1:melodic";
pub const EXPORTED_VOICE_ROLE_PERCUSSION_MARKER: &[u8] =
    b"chiptune-voice-separator:voice-role-v1:percussion";
