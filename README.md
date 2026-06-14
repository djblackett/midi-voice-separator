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
- Basic canvas piano-roll rendering.
- Focused frontend and Rust tests.

## Non-capabilities

This version does not yet perform voice separation, manual note correction, MIDI playback,
DAW routing, audio separation, or machine learning.

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

## Next milestone

The next milestone should introduce deterministic heuristic voice assignment, voice colors,
note selection, reassignment shortcuts, and export to separate MIDI tracks.
