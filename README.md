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
- Canvas piano-roll rendering: voice-colored notes (12 distinct colors before repeating), a
  dashed outline on low-confidence notes, and a confidence summary banner ("N% mean assignment
  confidence — M notes flagged for review"). A collapsible color-to-voice legend sits in the
  piano roll's bottom-right corner so
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
  locked constraint (so corrections survive a re-run), with an optional max-voice-count cap,
  a choice of separation strategy (Balanced, Channel priority, Register priority, Strict
  channel), and a choice of search mode (Greedy or Global) — different files separate better
  under different weightings, so try a few rather than relying on one fixed heuristic. The
  voice legend reflects exactly the voices the new result actually uses — a voice the re-run
  no longer needs (e.g. after lowering the cap) drops out instead of lingering as an empty
  row.
- Search mode "Global": an alternative to the default greedy assignment that keeps a sliding
  window of unlocked notes and exhaustively re-searches it on every note, only ever finalizing
  the oldest pending one, rather than committing each note irrevocably as soon as it's seen.
  Slower than Greedy but corrects a demonstrated class of greedy mistake — see Architecture
  below.
- Undo/redo (`Ctrl+Z` / `Ctrl+Shift+Z`) for selection-reassignment, voice-management, paint,
  pitch-range, and re-run-separation actions.
- Piano-roll pan/zoom, both axes: `Ctrl`/`Cmd`+wheel zooms horizontally and `Ctrl`/`Cmd`+`Shift`+
  wheel zooms vertically (both anchored at the cursor), plain wheel pans horizontally and
  `Shift`+wheel pans vertically — useful on a file with a wide pitch range, where rows can get
  too thin to read or click precisely at the default zoomed-out view. A minimap shows the
  current horizontal window against the full timeline, and review-mode `Tab`-stepping auto-pans
  on both axes (without changing zoom) to bring an off-screen flagged note into view.
- MIDI playback: Play/Pause/Stop and a time readout, with a choice of two sounds — chiptune
  (square/triangle/sawtooth oscillators cycling by voice, so a voice sounds consistent with
  how it looks) or a sampled grand piano (the CC-BY Salamander Grand Piano set, bundled in
  `public/samples/salamander/`, easier on the ears when the music gets dense) — plus a
  playhead that page-follows during playback, and a minimap that doubles as a seek control.
  Respects the existing voice Solo toggle (only the soloed voice is audible).
- Export of corrected voice assignments to a new Standard MIDI File (one track per voice).
- Fullscreen editor workspace: a toolbar toggle expands the piano roll to fill the viewport
  while keeping playback, view, paint, and heatmap controls visible above it.
- Named editor snapshots: save the current voice assignments/labels/order under a name, plus
  automatic snapshots on import and before/after each "Re-run separation." Restore is itself
  an undoable action and explicitly states it also restores which notes are locked for
  future re-runs; a snapshot's recorded re-run settings (strategy, search mode, max voices)
  can be applied on request without restoring state.
- Assignment diff: compare the current voice assignments against any snapshot. The engine
  matches voices by note overlap (not by id, since a full re-run allocates fresh voice ids)
  before counting reassignments, added/removed voices, and label changes, so a re-run that
  merely renames voice ids doesn't read as noise. Confidence-improved/worsened counts show
  only when both sides used the same separation strategy and search mode, since confidence
  isn't comparable across them. Changed notes get a colored edge cue directly in the piano
  roll, with a toggle to show only changed notes.
- Read-only A/B compare preview: view a past snapshot's assignments rendered in the piano
  roll without leaving the current session. All editing is disabled while previewing, with a
  visible banner explaining why; exiting returns to normal editing.
- Scoped playback: play all notes, just the selection, just the active voice, just the
  notes changed relative to the comparison target, or a window around the current flagged
  note — composed with the existing Solo toggle by intersection.
- Guided flagged-note review panel: steps through low-confidence notes one at a time with
  assign-to-voice, "Accept & lock" (pins the note to its current voice as a locked
  correction), and skip, auto-panning the roll to each note and showing review progress.
- Export readiness summary: an advisory (never blocking) checklist shown before export —
  unresolved flagged reviews, generic voice labels, empty/tiny voices, same-voice
  overlapping notes (impossible for a monophonic chiptune voice to play), changed notes not
  yet locked against the comparison baseline, and a percussion-voice note plus a reminder to
  manually verify a reimport.
- Voice lane view: a read-only alternate layout with one horizontal band per voice (instead
  of one shared pitch axis), for quickly auditing what each voice is doing without notes
  from other voices visually interleaved. Click a note to select it; editing happens back in
  the normal piano-roll view.
- Smart fix suggestions: conservative, advisory correction suggestions — nearby
  low-confidence clusters, suspicious tiny voices worth merging, and melodic phrases split
  across two voices — each with a plain-language reason and a one-click action that goes
  through the normal undoable correction path. Never touches percussion or locked notes.
- Paint mode with four tools, each with a drawn cursor overlay (the OS cursor is hidden over
  the roll): **Pencil** repaints exactly the note under the cursor; **Brush** repaints every
  note inside a resizable round brush swept along the drag (`[`/`]` or Alt+scroll to resize,
  Alt+drag to erase from the stroke); **Lasso** repaints every note enclosed by a freehand
  loop; **Wand** floods the whole melodically connected phrase from one click (a "Reach"
  slider sets the max pitch jump it will cross). Every stroke live-previews before commit and
  undoes as one step.
- Smart selection: double-click a note to select its whole vertically stacked chord; a
  right-click context menu offers "Select chord," "Select phrase" (the wand's flood-fill as
  a selection instead of a paint), "Keep top/bottom line only" (collapses a multi-chord
  selection to its melodic skyline or bass line), and "Assign to" voice swatches that act on
  the whole selection or just the clicked note depending on what's selected.
- Audition: clicking or painting a note plays a short, quiet blip at its pitch (throttled
  during a fast brush stroke, silent while transport playback is running), toggleable
  independently of Play/Pause/Stop.
- Confidence heatmap: an alternate note-coloring mode (`H` or a toolbar toggle) that recolors
  every note red-to-green by `assignmentConfidence` instead of by voice, so weak regions of
  an assignment are visible at a glance instead of only one flagged note at a time.
- Overlap conflict review: same-voice overlapping notes (which a monophonic chiptune voice
  can't actually represent) get a red underline cue on the canvas and a "Next overlap"
  stepper that mirrors flagged-note review, wrapping around the file.
- Time ruler: drag across the ruler above the piano roll to select every note sounding in
  that time range regardless of pitch; click it to seek/pan.
- Frontend (Vitest) and Rust (`cargo test`) test suites, plus a permanent Playwright
  end-to-end suite (`pnpm test:e2e`) driving the real dev-server bundle against a faked Tauri
  IPC boundary.

## Non-capabilities

This version does not yet perform DAW routing, audio separation, or machine learning.
Playback has no looping or per-voice volume beyond the existing Solo toggle, and no
general soundfont support (the piano sound is a single bundled sample set, not a
user-selectable soundfont). The current voice assignment is a heuristic, not a
finished musical separation algorithm.

The A/B compare preview is read-only by design — there is no editable side-B, split-screen
view, or A/B playback yet. Diffing and snapshots are in-session only: note ids are not
stable across an export/reimport round trip, so there is no cross-import diff and no
automated export→reimport verification (a real limitation, not an oversight — it would need
a content-based note-matching design and likely new Rust support). The diff panel's
confidence-delta metric is not available across different separation strategies or search
modes, since confidence measures local decisiveness under one scoring setup, not comparable
quality across two. Voice lanes are read-only (click-to-select only); the editing tools live
in the standard piano-roll view.

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
`{ startTick, endTick }` window. The pitch axis mirrors this exactly via a parallel
`PitchViewportWindow` resolved against the project's pitch span into a `{ lowestPitch,
highestPitch }` window, so the same render/hit-test code that doesn't know it's looking at a
zoomed-in tick range also doesn't know it's looking at a zoomed-in pitch range.

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

That greedy, note-at-a-time commitment has a known failure mode: an early note can have a
locally cheapest voice that, once more notes arrive, turns out to have foreclosed a much
better overall split (e.g. a clean low/high pitch-register grouping) that greedy can never
revisit once committed. `AssignmentMode` makes the search algorithm itself a user-facing
choice, orthogonal to `SeparationStrategy` (which only picks the cost weighting either
algorithm scores with): `Greedy` is the algorithm above; `Global` keeps a _sliding_ window of
up to 6 pending unlocked notes and, once it's full, re-solves the whole window on every new
note but commits only the oldest pending one — so every unlocked note is finalized only after
the search has already seen the next 5 notes, regardless of where it falls in the piece, and
a locked note simply flushes (solves and commits everything currently pending) before it's
pinned exactly as in `Greedy`. The search itself is capped at the true structural minimum
number of new voices the window can possibly need, computed with the same "minimum meeting
rooms" scheduling algorithm used for interval graphs, since scoring a brand-new voice at a
flat 0 would otherwise always beat any positive-cost reuse and degenerate into opening a new
voice for almost every note. This is not whole-piece-optimal, only exhaustive within each
6-note window, so a divergence spanning more than that can still slip through; it is a
wider-sighted heuristic, not a proof of global optimality. An earlier version committed fixed,
non-overlapping 6-note chunks instead of sliding one note at a time, which meant a note's
foresight depended on where it happened to land relative to a chunk boundary — a note last in
its chunk got none. A constructed regression test (placing the same adversarial pattern so its
pivot note lands exactly on an old chunk boundary) confirmed the fixed-chunk version got it
wrong there while the sliding version gets it right, at roughly 5-6x the search cost (still
under 155 ms on a synthetic 8,000-note/16-voice worst case, since it now solves once per note
instead of once per 6 notes). Confirmed empirically (a brute-force oracle built to test this
before implementing `Global` at all) that greedy diverges from the true minimum-cost partition
in a meaningful fraction of realistic cases, occasionally by a wide margin.

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

The original correction-UX plan (multi-select, voice management, confidence scoring, review
mode, paint mode, locked re-run, undo/redo, pan/zoom, playback, separation-strategy and
search-mode selection, pitch-range provenance) is complete and was validated on two real
CC0-licensed dense chiptune fixtures alongside synthetic stress tests, confirmed fast at
every scale tried.

A second plan (snapshots, assignment diff, read-only A/B compare, scoped playback, guided
review, export readiness, voice lanes, smart fix suggestions) is also complete — see
"Current capabilities" above. A follow-on pass then added paint mode's pencil/brush/lasso/wand
tools with a drawn cursor overlay, smart selection (chord/phrase/top-line/bottom-line, a
right-click context menu), click/paint audition, a confidence heatmap view, overlap-conflict
review, time-ruler range selection, and a fullscreen editor workspace.

What remains is what earlier plans explicitly deferred rather than left unfinished — see
"Non-capabilities" above for the reasoning behind each: an editable A/B compare side with
split-screen and A/B playback; cross-import diffing and automated export→reimport
verification (blocked by note ids not surviving a round trip — its own plan, needing
content-based matching); a cost-based cross-strategy quality metric for the diff panel
(would need a new Rust command); and voice-lane editing parity. Any of these, or a fresh
idea, would start a new plan.
