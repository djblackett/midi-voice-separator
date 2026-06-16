pub mod exporter;
pub mod model;
pub mod parser;
pub mod voice_assignment;

pub use model::{ExportMidiResultDto, MidiProjectDto};

pub const EXPORTED_VOICE_TRACK_NAME: &[u8] = b"Chiptune Voice Separator Voice";
