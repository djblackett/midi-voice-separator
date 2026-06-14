use serde::Serialize;
use std::{fmt, io};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AppErrorCode {
    EmptyPath,
    UnsupportedFileExtension,
    FileNotFound,
    PermissionDenied,
    UnreadableFile,
    InvalidMidi,
    UnsupportedTimingFormat,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: AppErrorCode,
    pub message: String,
}

impl AppError {
    pub fn empty_path() -> Self {
        Self {
            code: AppErrorCode::EmptyPath,
            message: "Select a MIDI file before importing.".to_string(),
        }
    }

    pub fn unsupported_extension() -> Self {
        Self {
            code: AppErrorCode::UnsupportedFileExtension,
            message: "Select a file with a .mid or .midi extension.".to_string(),
        }
    }

    pub fn from_io(error: &io::Error) -> Self {
        match error.kind() {
            io::ErrorKind::NotFound => Self {
                code: AppErrorCode::FileNotFound,
                message: "The selected MIDI file could not be found.".to_string(),
            },
            io::ErrorKind::PermissionDenied => Self {
                code: AppErrorCode::PermissionDenied,
                message: "The selected MIDI file could not be read because permission was denied."
                    .to_string(),
            },
            _ => Self {
                code: AppErrorCode::UnreadableFile,
                message: "The selected MIDI file could not be read.".to_string(),
            },
        }
    }

    pub fn invalid_midi() -> Self {
        Self {
            code: AppErrorCode::InvalidMidi,
            message: "The selected file is not a valid Standard MIDI File.".to_string(),
        }
    }

    pub fn unsupported_timing_format() -> Self {
        Self {
            code: AppErrorCode::UnsupportedTimingFormat,
            message: "This MIDI file uses SMPTE/timecode timing, which is not supported yet."
                .to_string(),
        }
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{:?}: {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}
