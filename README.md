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
  review"). A collapsible color-to-voice legend sits in the piano roll's bottom-right corner so
  you don't have to scroll up to the "Voices" panel to remember which color is which.
- Multi-note selection: click, shift-click to add/remove, or drag a marquee over many.
- Bulk voice reassignment with `1`-`9` keyboard shortcuts.
- Voice management: create, inline-rename, merge, solo (dim other voices), and reorder voices.
- Flagged-note review mode: `Tab`/`Shift+Tab` step through low-confidence notes, or use the
  "Review flagged notes" button.
- Paint mode: toggle, pick an active voice, then click-drag across notes to repaint them.
- Pitch-range mode: drag horizontal marker handles in the piano-roll label gutter, then
  apply them to bulk-assign notes to voices by pitch band (above/between/below markers).
  Reapplying after nudging a marker only touches notes still under range control — any note
  since reassigned, painted, merged, or otherwise hand-corrected is left alone.
- "Re-run separation": re-runs the heuristic while treating every manual correction as a
  locked constraint (so corrections survive a re-run), with an optional max-voice-count cap
  and a choice of separation strategy (Balanced, Channel priority, Register priority, Strict
  channel) — different files separate better under different weightings, so try a few rather
  than relying on one fixed heuristic. The voice legend reflects exactly the voices the new
  result actually uses — a voice the re-run no longer needs (e.g. after lowering the cap)
  drops out instead of lingering as an empty row.
- Undo/redo (`Ctrl+Z` / `Ctrl+Shift+Z`) for selection-reassignment, voice-management, paint,
  pitch-range, and re-run-separation actions.
- Piano-roll pan/zoom: `Ctrl`/`Cmd`+wheel zooms anchored at the cursor, plain wheel pans, a
  minimap shows the current window against the full timeline, and review-mode `Tab`-stepping
  auto-pans (without changing zoom) to bring an off-screen flagged note into view.
- MIDI playback: Play/Pause/Stop and a time readout, synthesized with square/triangle/
  sawtooth oscillators cycling by voice (so a voice sounds consistent with how it looks), a
  playhead that page-follows during playback, and a minimap that doubles as a seek control.
  Respects the existing voice Solo toggle (only the soloed voice is audible).
- Export of corrected voice assignments to a new Standard MIDI File (one track per voice).
- Frontend (Vitest) and Rust (`cargo test`) test suites.

## Non-capabilities

This version does not yet perform DAW routing, audio separation, or machine learning.
Playback is synthesized tones, not sample/soundfont-based, and has no looping or per-voice
volume beyond the existing Solo toggle. The current voice assignment is a heuristic, not a
finished musical separation algorithm.

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

Ticks are the canonical timing coordinate; a `TempoMap` (a piecewise-linear tick/seconds
mapping built from the project's tempo changes, defaulting to 120 BPM if none is present)
converts to/from seconds for the playback time readout and audio scheduling, without making
seconds the canonical unit anywhere else. The piano roll is a single HTML Canvas with
coordinate math isolated from React, so pan/zoom is a separate `ViewportWindow` (zoom level +
pan position) resolved against the project's duration into a concrete tick range each render,
rather than the canvas always spanning the whole project — `drawPianoRoll`/hit-testing don't
know the difference, since both already work in terms of an arbitrary
`{ startTick, endTick }` window.

Playback runs entirely in the frontend via the Web Audio API — no Rust/Tauri involvement.
A pure function decides what should play (which notes, truncated correctly for a mid-note
resume, filtered to a soloed voice, with a waveform assigned per voice); a thin engine class
just iterates that decision and issues real `AudioContext` calls, scheduling every note for a
play-from-tick call up front rather than with a rolling lookahead scheduler — simple and
sufficient at chiptune-file scale.

`midly` parses SMF data into structures that borrow from the input byte buffer. The Rust
parser converts those borrowed structures into owned application DTOs before returning them
through Tauri.

Voice assignment is a deterministic cost-based heuristic: notes are processed in time order,
and each note is scored against every non-overlapping ("compatible") existing voice on pitch
distance from that voice's last note, how far it falls outside the voice's established pitch
range so far, a silence-gap penalty, and a channel-continuity bonus. The lowest-cost voice
wins; the gap between the winner and the runner-up becomes that note's confidence score. The
three weights behind those terms are bundled into a `SeparationStrategy` (Balanced, Channel
priority, Register priority, Strict channel) selectable from "Re-run separation" — the same
scoring function throughout, just weighted differently, since different files (e.g. clean
per-channel MIDI vs. a dense single-channel chiptune export) separate better under different
weightings. A note locked by a manual correction skips scoring entirely and is pinned
directly to its voice, which still updates that voice's pitch/channel/timing state so
unlocked neighbors keep being pulled toward a correction rather than ignoring it — unaffected
by which strategy is active. This makes the heuristic explainable and its corrections durable
across a re-run, without claiming final musical correctness.

Manual corrections are represented as a frontend-only note-to-voice override map layered on
top of the immutable imported project; voice identity, order, and labels are separate
frontend state, not solely derived from whatever the heuristic produced. A parallel set of
note IDs tracks which entries in that override map were written by the last pitch-range
application (as opposed to a click reassignment, paint stroke, or merge); reapplying pitch
ranges after nudging a marker only overwrites notes still in that set, so a hand correction
made after the last apply survives a later one. "Re-run separation"
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
max-voice-count cap, undoable re-run), piano-roll pan/zoom, MIDI playback, a performance
validation pass, and pitch-range provenance tracking are all complete — the Rust heuristic
handles thousands of overlapping notes in well under a millisecond, every frontend interaction
stayed fast against a synthetic 600-note/6-voice/86-flagged-note project (no real dense
chiptune `.mid` fixture exists yet to validate against directly), and reapplying pitch ranges
no longer clobbers hand corrections made since the last apply. The minimap/marquee top-pixel
interaction gap found during performance validation is also fixed: the minimap now occupies
its own reserved band above the canvas instead of overlaying its top 6 pixels, so a
marquee-select drag starting there reaches the canvas instead of the minimap. "Re-run
separation" also gained a separation-strategy selector (Balanced, Channel priority, Register
priority, Strict channel), in response to real-world testing showing the single fixed
heuristic weighting could let a voice drift across several octaves on a dense,
mostly-single-channel chiptune file — rather than chase one "best" weighting further, the
fix exposes a few distinct presets to try per file. There is no open candidate left from this
roadmap; the next milestone would start a fresh plan.
