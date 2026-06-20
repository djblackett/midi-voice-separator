# Chiptune Voice Separator

## Purpose

Chiptune Voice Separator turns dense MIDI transcriptions into separate, editable musical
voices. It imports a Standard MIDI File, normalizes its note data in Rust, runs a heuristic
that guesses a per-note voice assignment with a confidence score, and gives the user a fast,
keyboard-and-mouse-driven editor to correct that guess before exporting clean, separated
tracks.

## Current capabilities

- Native Tauri 2 desktop window.
- MIDI-file selection through the Tauri dialog plugin.
- Rust MIDI parsing with `midly`; owned, serializable MIDI DTOs returned to the frontend.
- Heuristic voice assignment with a per-note confidence score and reason code (channel
  continuity, closest pitch, forced new voice, imported, or user-locked).
- Canvas piano-roll rendering: voice-colored notes, a dashed outline on low-confidence notes,
  and a confidence summary banner ("N% mean assignment confidence — M notes flagged for
  review").
- Multi-note selection: click, shift-click to add/remove, or drag a marquee over many.
- Bulk voice reassignment with `1`-`9` keyboard shortcuts.
- Voice management: create, inline-rename, merge, solo (dim other voices), and reorder voices.
- Flagged-note review mode: `Tab`/`Shift+Tab` step through low-confidence notes, or use the
  "Review flagged notes" button.
- Paint mode: toggle, pick an active voice, then click-drag across notes to repaint them.
- Pitch-range mode: drag horizontal marker handles in the piano-roll label gutter, then
  apply them to bulk-assign notes to voices by pitch band (above/between/below markers).
- "Re-run separation": re-runs the heuristic while treating every manual correction as a
  locked constraint (so corrections survive a re-run), with an optional max-voice-count cap.
- Undo/redo (`Ctrl+Z` / `Ctrl+Shift+Z`) for selection-reassignment, voice-management, paint,
  pitch-range, and re-run-separation actions.
- Piano-roll pan/zoom: `Ctrl`/`Cmd`+wheel zooms anchored at the cursor, plain wheel pans, a
  minimap shows the current window against the full timeline, and review-mode `Tab`-stepping
  auto-pans (without changing zoom) to bring an off-screen flagged note into view.
- Export of corrected voice assignments to a new Standard MIDI File (one track per voice).
- Frontend (Vitest) and Rust (`cargo test`) test suites.

## Non-capabilities

This version does not yet perform MIDI playback, DAW routing, audio separation, or machine
learning. The current voice assignment is a heuristic, not a finished musical separation
algorithm. Pitch-range rules don't yet track provenance, so reapplying them overwrites
matching notes' voice assignments even if they were since hand-corrected.

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
lossless. The piano roll is a single HTML Canvas with coordinate math isolated from React, so
pan/zoom is a separate `ViewportWindow` (zoom level + pan position) resolved against the
project's duration into a concrete tick range each render, rather than the canvas always
spanning the whole project — `drawPianoRoll`/hit-testing don't know the difference, since both
already work in terms of an arbitrary `{ startTick, endTick }` window.

`midly` parses SMF data into structures that borrow from the input byte buffer. The Rust
parser converts those borrowed structures into owned application DTOs before returning them
through Tauri.

Voice assignment is a deterministic cost-based heuristic: notes are processed in time order,
and each note is scored against every non-overlapping ("compatible") existing voice on pitch
distance, a silence-gap penalty, and a channel-continuity bonus. The lowest-cost voice wins;
the gap between the winner and the runner-up becomes that note's confidence score. A note
locked by a manual correction skips scoring entirely and is pinned directly to its voice,
which still updates that voice's pitch/channel/timing state so unlocked neighbors keep being
pulled toward a correction rather than ignoring it. This makes the heuristic explainable and
its corrections durable across a re-run, without claiming final musical correctness.

Manual corrections are represented as a frontend-only note-to-voice override map layered on
top of the immutable imported project; voice identity, order, and labels are separate
frontend state, not solely derived from whatever the heuristic produced. "Re-run separation"
sends the original imported notes plus the current override map (as a lock set) back to
Rust, which re-runs the heuristic respecting those locks and an optional voice-count cap
(forcing reuse of the lowest-cost existing voice, marked at zero confidence for review,
rather than exceeding the cap) and returns an updated project. That call is itself a single
undo/redo step, like every other correction. Export sends the current corrected project to
Rust, which writes a format-1 Standard MIDI File with a conductor track and one note track
per voice.

## Next milestone

The correction-UX plan (multi-select, voice management, confidence scoring, review mode,
paint mode, locked re-run, undo/redo), both items it originally deferred (the
max-voice-count cap, undoable re-run), and piano-roll pan/zoom are complete. Candidates for
the next milestone: MIDI playback so corrections can be checked by ear instead of only by
eye, a performance pass on real dense chiptune files, or provenance tracking for
pitch-range-generated overrides so reapplying ranges doesn't clobber hand corrections.
