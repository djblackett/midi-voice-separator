# Chiptune Voice Separator

## Purpose

Chiptune Voice Separator is intended to turn dense MIDI transcriptions into separate,
editable musical voices. This first milestone is deliberately limited to importing a Standard
MIDI File, normalizing its note data in Rust, and visualizing the result in a React canvas
piano roll.

## Current capabilities

- Native Tauri 2 desktop window.
- MIDI-file selection through the Tauri dialog plugin.
- Rust MIDI parsing with `midly`.
- Owned, serializable MIDI DTOs returned to the frontend.
- Deterministic heuristic voice assignment for imported notes.
- Basic canvas piano-roll rendering.
- Voice-colored note display.
- Single-note selection with selected-note details.
- Frontend-only selected-note reassignment with number-key shortcuts.
- Focused frontend and Rust tests.

## Non-capabilities

This version does not yet export corrected voices, perform MIDI playback, DAW routing, audio
separation, or machine learning. The current voice assignment is a deterministic first-pass
heuristic, not a finished musical separation algorithm. Reassignment exists only in frontend
state until export is implemented.

## Windows prerequisites

Build this Windows desktop application from a native Windows shell, not WSL or a `\\wsl$`
path.

Install:

- Node.js stable or LTS.
- pnpm.
- Rust through rustup with the stable MSVC toolchain, normally
  `stable-x86_64-pc-windows-msvc`.
- Microsoft C++ Build Tools or Visual Studio with the "Desktop development with C++" tools.
- Microsoft Edge WebView2 Runtime.

## Development commands

```powershell
pnpm install
pnpm tauri dev
pnpm build
pnpm test
pnpm lint
pnpm format:check
pnpm rust:check
pnpm rust:test
pnpm rust:clippy
```

## Architecture

React renders the editor UI in the WebView. Rust owns native file access and MIDI parsing.
Tauri commands form the boundary between those processes: the frontend selects a path with
the dialog plugin, passes that path to Rust with `invoke`, and receives owned serializable
DTOs.

Ticks are the canonical timing coordinate. The frontend can eventually derive seconds for
display or playback, but the imported model keeps PPQ tick positions so MIDI timing remains
lossless. The piano roll is a single HTML Canvas with coordinate math isolated from React so
zooming, scrolling, selection, and editing can be added without rewriting the renderer.

`midly` parses SMF data into structures that borrow from the input byte buffer. The Rust
parser converts those borrowed structures into owned application DTOs before returning them
through Tauri.

The current voice assignment is a simple monophonic-lane heuristic: notes are processed in
deterministic order, a compatible non-overlapping voice is reused when possible, and the
closest prior pitch wins ties. This makes the first visual grouping repeatable without
claiming final musical correctness.

Manual corrections are currently represented as frontend-only note-to-voice overrides. The
imported Rust DTO remains unchanged, and the displayed project is derived from the import plus
those overrides.

## Next milestone

The next milestone should persist corrected assignments into an export command that writes
separate MIDI tracks.
