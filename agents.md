# AI Agent Coordination

This file is the coordination point for AI-assisted work in this repository.
Read it before making changes, and keep updates small enough that another agent
can understand and verify them quickly.

## Repository

This repo is `chiptune-voice-separator`, a Tauri 2 desktop app for importing
Standard MIDI Files, assigning notes to editable chiptune-style voices, manually
correcting those assignments, and exporting the corrected MIDI.

Primary stack:

- Frontend: React, TypeScript, Vite, Vitest, canvas piano roll.
- Desktop boundary: Tauri commands and plugins.
- Backend: Rust, `midly`, owned serializable MIDI DTOs.
- Package manager: `pnpm`.

## Working Rules

- Start with `git status --short` and preserve any existing user or agent
  changes. Do not revert unrelated work unless explicitly asked.
- Prefer focused vertical slices over broad refactors. Each slice should leave
  the app buildable and testable.
- Keep imported Rust DTOs immutable from the frontend perspective. Manual
  correction state should stay derived from the imported project unless a task
  explicitly changes that model.
- Preserve the user workflow order: import MIDI, inspect/select notes, reassign
  voices, export corrected MIDI, then verify by reimporting when persistence is
  involved.
- Treat native file dialogs as manual verification points if automation cannot
  interact with them. Code and startup validation are still required.
- Use existing project patterns before adding new abstractions.
- Do not claim success without command evidence.

## Code Map

- `src/`: React frontend.
- `src/app/App.tsx`: main import, correction, and export flow.
- `src/features/piano-roll/drawPianoRoll.ts`: canvas rendering.
- `src/features/piano-roll/PianoRoll.tsx`: pointer-gesture handling
  (click/shift-click/marquee select, plus paint-mode click-drag) and canvas
  lifecycle. Exports `InteractionMode = "select" | "paint" | "range"`.
- `src/features/piano-roll/viewportWindow.ts`: pure pan/zoom math
  (`ViewportWindow` = zoom level + raw pan position, resolved against a
  project's `durationTicks` into a concrete clamped tick range via
  `visibleTickRange`). `zoomAt` keeps an anchor tick stationary on screen;
  `panToReveal` pans (never zooms) to bring a tick range into view with a
  10% margin. Kept separate from `PianoRoll.tsx` for the same
  unit-testability reason as `selection.ts`/`paint.ts`.
- `src/features/piano-roll/paint.ts`: pure `shouldPaintNote` predicate used
  by `PianoRoll.tsx`'s paint-stroke logic (kept separate for the same
  unit-testability reason as `selection.ts`).
- `src/features/piano-roll/hitTest.ts`: piano-roll point and rectangle hit
  testing.
- `src/features/piano-roll/selection.ts`: pure selection-state resolution for
  click/shift-click/marquee gestures (kept separate from PianoRoll so it's
  unit-testable without a DOM/canvas).
- `src/domain/midi/voiceAssignments.ts`: applies the note-id-to-voice-id
  override map onto imported notes (does not own voice list/order/labels).
- `src/domain/midi/voiceManagement.ts`: voice list construction
  (`buildVoiceList`), new-voice id allocation (`nextVoiceId`), and
  voice-merge override patches (`mergeVoiceOverrides`). Voice identity/order/
  labels are corrigible state owned by `App.tsx`, independent of whatever
  the heuristic originally produced.
- `src-tauri/src/midi/parser.rs`: MIDI import and owned DTO conversion.
- `src-tauri/src/midi/voice_assignment.rs`: deterministic voice assignment and
  voice summary logic.
- `src-tauri/src/midi/exporter.rs`: corrected MIDI export.
- `src-tauri/src/commands/midi.rs`: Tauri command boundary.
- `fixtures/`: manual and test MIDI fixtures.
- `src-tauri/src/midi/model.rs`: DTOs, including `AssignmentReason` and
  `SeparationSummaryDto` (per-note and per-project confidence diagnostics).
- `src/domain/midi/midiProject.ts`: also holds `formatSeparationSummary` and
  the single frontend `LOW_CONFIDENCE_THRESHOLD` constant (mirrors the Rust
  one; both `drawPianoRoll.ts`'s dashed-outline cue and
  `reviewQueue.ts`'s flagged-note queue read this one constant so they never
  disagree on what counts as "flagged").
- `src/domain/midi/reviewQueue.ts`: `buildFlaggedNoteQueue` (time-sorted
  low-confidence notes) and `findNextFlaggedNoteId` (pure, wraps-around
  stepping logic for review mode — kept separate from `App.tsx` so it's
  unit-testable without React).
- `src-tauri/src/midi/voice_assignment.rs`: also exports
  `assign_heuristic_voices_with_locks` (locked-note-aware re-run, used by
  the `reassign_voices` Tauri command) and the private `allocate_new_voice_id`
  collision-avoiding id allocator it depends on.
- `src/domain/midi/voiceManagement.ts`: also holds `mergeVoiceOrder`
  (append-only: folds brand-new voice ids into `voiceOrder` for
  incremental corrections that never remove notes from a voice
  wholesale) and `reconcileVoiceOrderAfterReassign` (used only after
  "re-run separation": same append behavior, but also drops any voice
  id no note is assigned to anymore, since a full re-run decides the
  entire voice structure fresh and a no-longer-used id shouldn't
  linger in the legend as an empty row).
- `src/app/editorHistory.ts`: pure full-snapshot undo/redo stack
  (`createEditorHistory`, `pushHistory`, `undoHistory`, `redoHistory`) over
  `{ voiceOverrides, voiceOrder, voiceLabels }`. Kept separate from `App.tsx`
  so the stack-manipulation logic is unit-testable without React.
- `src/domain/midi/tempoMap.ts`: pure tick/seconds conversion
  (`buildTempoMap`, `tickToSeconds`, `secondsToTick`) — a piecewise-linear
  map built from a project's `tempoChanges`, defaulting to 120 BPM if none
  exists at tick 0. Used by both the time readout and playback scheduling.
- `src/features/playback/`: the playback feature, frontend-only (Web Audio,
  no Rust/Tauri involvement). Pure and unit-tested: `frequency.ts`
  (`midiPitchToFrequency`), `scheduledNotes.ts` (`buildScheduledNotes` —
  the only function that decides what should play: filters notes already
  past the resume point, truncates a mid-note resume instead of skipping
  or mistiming it, filters to a soloed voice, picks a waveform per voice
  via `drawPianoRoll.ts`'s exported `voiceColorIndex` so a voice sounds
  consistent with how it looks), `formatPlaybackTime.ts`. Thin and
  untested (real audio I/O, same category as `PianoRoll.tsx`'s
  pointer-event glue): `playbackEngine.ts` (a small `PlaybackEngine` class
  wrapping one `AudioContext`; `play()` creates an oscillator+gain-envelope
  node pair per scheduled note and tracks all of them so `stop()` can
  immediately silence everything including notes scheduled in the future,
  not just whatever's currently sounding) and `usePlaybackEngine.ts` (the
  React hook tying the engine to `isPlaying`/`currentTick` state, polled
  every 50ms rather than via `requestAnimationFrame` — simpler and
  sufficient at this update rate).

## Active Plan

The original 7-phase implementation plan for the heuristic voice-separation
engine and its correction UX is complete (all 7 phases done — see Progress
Log below). The follow-on roadmap (testing gap, README catch-up, the two
deferred items, piano-roll pan/zoom, MIDI playback) is also complete —
Phase 5 (playback) had its own dedicated plan, written at the same path
`C:\Users\davej\.claude\plans\sequential-watching-sprout.md` (outside this
repo) once selected. Only roadmap Phase 6 (performance validation on real
dense files) remains.

## Progress Log

- **Phase 1 (multi-select + bulk reassignment) — done.** Selection state in
  `App.tsx` changed from a single `selectedNoteId` to a
  `selectedNoteIds: ReadonlySet<string>`. `PianoRoll.tsx` now resolves
  click / shift-click / marquee-drag / shift-marquee gestures into a next
  selection set via the new pure `resolveSelection` helper in `selection.ts`,
  using pointer capture so a marquee drag tracks correctly even if the
  pointer leaves the canvas. `hitTest.ts` gained
  `hitTestPianoRollNotesInRect` for the marquee's rectangle-intersection
  test. `drawPianoRoll.ts` now takes a `selectedNoteIds` set (was a single
  id) and an optional `marqueeRect` to draw the in-progress selection
  rectangle. The `1`-`9` voice-reassignment shortcut now applies to every
  selected note instead of just one. Added
  `formatSelectionSummary` to `midiProject.ts` for the multi-select detail
  panel.
  - Verified: `pnpm test` (38/38 passing, including new
    `hitTest.test.ts` rect cases and new `selection.test.ts`), `pnpm lint`,
    `pnpm format:check`, `pnpm build`, `pnpm rust:check` (untouched, still
    clean).
  - Not yet verified: manual `pnpm tauri dev` click-through (no live desktop
    session run in this pass — do this before considering Phase 1 fully
    closed).

- **Phase 2 (voice management primitives) — done.** Voice identity is no
  longer purely derived from `project.voices`. `App.tsx` now owns
  `voiceOrder: string[]` (seeded from the import, reset on each new import)
  and `voiceLabels: Record<string, string>` alongside the existing
  `voiceOverrides`. `displayedProject.voices` is built by the new
  `buildVoiceList(voiceOrder, voiceLabels, notes)` in `voiceManagement.ts`
  instead of the old `recomputeVoiceSummaries` (removed from
  `voiceAssignments.ts`, which now only patches note `voiceId`s — see its
  narrowed responsibility above). The voice legend in `App.tsx` is now
  interactive: "+ New voice" (`nextVoiceId` + optional immediate assignment
  of the current selection), inline rename (text input bound to
  `voiceLabels`), per-voice "Merge into..." `<select>` (uses
  `mergeVoiceOverrides` then drops the source id from `voiceOrder`), a Solo
  toggle (`soloVoiceId`, threaded through `PianoRoll` to `drawPianoRoll`,
  which dims non-solo notes via `globalAlpha`), and ▲/▼ reorder buttons
  (voice order drives the `1`-`9` keymap, so reordering is exposed instead
  of drag-and-drop for simplicity/robustness per the plan). Clicking a
  voice's color swatch sets it active and also selects every note currently
  in that voice — a free "select all notes in this voice" shortcut ahead of
  Phase 5's paint mode.
  - Verified: `pnpm test` (44/44, including new `voiceManagement.test.ts`
    and a trimmed `voiceAssignments.test.ts` whose voice-summary
    expectations moved to `voiceManagement.test.ts`), `pnpm lint`,
    `pnpm format:check`, `pnpm build`, `pnpm rust:check` (untouched, still
    clean).
  - Not yet verified: manual `pnpm tauri dev` click-through for create/
    rename/merge/solo/reorder.

- **Phase 3 (heuristic confidence scoring + reason codes) — done.**
  `assign_heuristic_voices` in `voice_assignment.rs` no longer picks purely
  by nearest prior pitch; it now scores every compatible (non-overlapping)
  voice with a small weighted cost — pitch distance, a silence-gap penalty
  normalized over `GAP_NORMALIZATION_TICKS`, and a `CHANNEL_CONTINUITY_BONUS`
  that rewards reusing a voice whose last note shared the new note's MIDI
  channel (signal the old heuristic ignored entirely). Confidence is derived
  from the cost gap between the winner and the runner-up
  (`CONFIDENCE_SCALE`-normalized, clamped to `[0,1]`); a forced new voice
  (no compatible candidate) or a single forced candidate is confidence
  `1.0`. Each note now carries `assignment_confidence: f32` and
  `assignment_reason: AssignmentReason` (`Imported` | `ChannelContinuity` |
  `ClosestPitch` | `NewVoiceNoFit`) in `model.rs`. Notes from
  already-exported voice tracks get `Imported`/`1.0` directly in
  `parser.rs`'s `push_note` (never run through the cost model). A new
  `summarize_separation_quality` produces `SeparationSummaryDto`
  (`mean_confidence`, `low_confidence_note_count` below
  `LOW_CONFIDENCE_THRESHOLD = 0.5`, `voice_count`), attached to
  `MidiProjectDto.separation_summary` and computed once in `parse_midi_project`.
  **Note:** `MidiNoteDto`/`MidiProjectDto` dropped their `Eq` derive (kept
  `PartialEq`) since `f32` isn't `Eq` — confirmed nothing else needed `Eq`
  specifically. On the frontend, `midiProject.ts` mirrors these types and
  adds `formatSeparationSummary`; `App.tsx` shows it as a banner under the
  file-details section; `drawPianoRoll.ts` renders a dashed outline for any
  unselected note below `LOW_CONFIDENCE_THRESHOLD` (later centralized in
  `midiProject.ts` during Phase 4 — see below).
  - Verified: `pnpm rust:test` (27/27, including new tests for the channel-
    continuity bonus, a forced-tie confidence-zero case, and
    `summarize_separation_quality`), `cargo fmt --check`, `pnpm rust:check`,
    `pnpm rust:clippy` (`-D warnings`), `pnpm test` (48/48 — every TS fixture
    constructing a `MidiNote`/`MidiProject` literal was updated for the new
    required fields), `pnpm lint`, `pnpm format:check`, `pnpm build`.
  - Not yet verified: manual `pnpm tauri dev` pass to eyeball the confidence
    banner and dashed low-confidence outlines against a real dense MIDI file.

- **Phase 4 (flagged-note review mode) — done.** Centralized
  `LOW_CONFIDENCE_THRESHOLD` as a single exported constant in
  `midiProject.ts` (frontend source of truth for "is this note flagged");
  `drawPianoRoll.ts` now imports it instead of keeping its own copy. New
  `reviewQueue.ts` adds `buildFlaggedNoteQueue` (low-confidence notes sorted
  by `startTick`) and `findNextFlaggedNoteId`, a pure stepping function that
  jumps to the next/previous flagged note relative to the current
  selection's start tick, wrapping around at either end (so review mode is
  a continuous loop, not a dead-ended list) and falling back to the nearest
  flagged note if the current selection isn't itself flagged. `App.tsx`
  derives `flaggedNotes` via `useMemo`, wires `Tab` / `Shift+Tab` into the
  existing keydown handler (guarded by the same input-focus check as the
  other shortcuts; only intercepts Tab when there's at least one flagged
  note, so normal focus-traversal Tab behavior is untouched otherwise), and
  shows a "Review flagged notes (N)" button in the separation-summary
  banner that reuses the same stepping function.
  - **Known, deliberately accepted limitation:** the piano roll still has no
    pan/zoom — it always renders the full project duration compressed into
    the canvas width (`buildViewport` in `drawPianoRoll.ts`). Tab-stepping
    selects and highlights the flagged note correctly, but on a long file it
    may be a thin sliver rather than something scrolled into a comfortable
    view. This was called out in the plan as out of scope for this phase;
    treat it as a future "viewport pan/zoom" milestone, not a Phase 4 bug.
  - Verified: `pnpm test` (58/58, including new `reviewQueue.test.ts`
    covering empty-queue, no-selection, forward/backward stepping, wrap-
    around in both directions, and the not-itself-flagged fallback),
    `pnpm lint`, `pnpm format:check`, `pnpm build`, `pnpm rust:check`
    (untouched, still clean).
  - Not yet verified: manual `pnpm tauri dev` pass to confirm Tab/Shift+Tab
    and the review button feel right against a real dense MIDI file with a
    long timeline (where the no-pan/zoom limitation above will be most
    visible).
  - Next: Phase 5 (paint mode).

- **Phase 5 (paint mode) — done.** `PianoRoll.tsx` now exports
  `InteractionMode = "select" | "paint"`. `App.tsx` owns `interactionMode`
  state (toggled by a "Paint mode: on/off" button in a new
  `.piano-roll-toolbar` above the canvas — a click toggle, not a held key,
  per the plan's reasoning that holding a key while dragging is unreliable
  across pointer devices) and reuses the existing `activeVoiceId` from
  Phase 2 as the paint "brush" voice. In paint mode, number keys `1`-`9` now
  set `activeVoiceId` instead of reassigning the selection (selection-based
  reassignment is meaningless in paint mode, since painting doesn't use the
  selection set at all).
  In `PianoRoll.tsx`, paint-mode pointer-down/move hit-tests the note under
  the cursor and accumulates touched ids into a `paintedNoteIdsRef: Map<noteId, voiceId>`
  — a ref, not React state, so a drag doesn't trigger a re-render per pixel.
  A new `redrawCanvas()` helper calls `drawPianoRoll` imperatively (reusing
  the already-computed `viewport`/`effectiveSelection`/etc. from the
  enclosing render) whenever a _new_ note is touched, giving a live color
  preview without going through React. The whole stroke is flushed as a
  single `onPaintNotes(noteIds[])` call on `pointerup`, so it becomes one
  undoable action once Phase 7 lands. `drawPianoRoll.ts` gained a
  `paintPreview: ReadonlyMap<string, string>` parameter; rendering now reads
  an `effectiveVoiceId = paintPreview.get(note.id) ?? note.voiceId` for fill/
  stroke color and solo-dimming (so painting into a soloed voice lights the
  note up immediately), while confidence/dashed-outline styling stays keyed
  to the note's real (unchanged) `assignmentConfidence`. New pure
  `shouldPaintNote` in `paint.ts` (note is in a different voice than the
  brush, and not already touched this stroke) keeps the only nontrivial
  paint logic unit-testable without a DOM/canvas, mirroring `selection.ts`.
  - Verified: `pnpm test` (61/61, including new `paint.test.ts`), `pnpm lint`,
    `pnpm format:check`, `pnpm build`, `pnpm rust:check` (untouched, still
    clean).
  - Not yet verified: manual `pnpm tauri dev` pass to confirm the click-drag
    paint gesture and live color preview feel right against a real dense
    MIDI file — this phase is the most interaction-heavy one so far and
    benefits most from an actual pointer-driven check.
  - Next: Phase 6 (locking + constrained re-run).

- **Phase 6 (locking + constrained re-run) — done.** No new "lock" state was
  added — per the plan, any note with an entry in `voiceOverrides` already
  _is_ the locked set (`Object.keys(voiceOverrides)`), so a re-run treats
  every manual correction (single, bulk, or paint) as a hard constraint
  automatically.
  Rust: `voice_assignment.rs`'s core loop was generalized into
  `assign_heuristic_voices_with_locks(notes, locked: &HashMap<String, String>)`;
  `assign_heuristic_voices` is now a thin wrapper calling it with an empty
  map (verified behaviorally identical via a new regression test). For each
  note, if `locked` has an entry, the note is pinned directly to that voice
  (confidence `1.0`, new `AssignmentReason::UserLocked`) and the voice's
  running pitch/channel/end-tick state is updated exactly like an unlocked
  assignment would — so unlocked neighbors still get pulled toward a
  manually corrected voice by the normal cost model. New voice ids for
  unlocked notes are no longer `format!("voice-{}", index+1)`; a new
  `allocate_new_voice_id` scans for the lowest-numbered `voice-N` not
  already in use _and_ not reserved by any locked id that hasn't been
  encountered yet in note order — necessary because a locked id can be an
  arbitrary existing `voice-N` (e.g. one the user created or merged into)
  that has nothing to do with creation order, so positional id generation
  could otherwise collide with a locked id before that locked note is ever
  reached in the time-ordered pass.
  New `#[tauri::command] reassign_voices(project: MidiProjectDto, locked: HashMap<String,String>) -> Result<MidiProjectDto, AppError>`
  in `commands/midi.rs` (registered in `lib.rs`'s `generate_handler!`) calls
  the locked variant and recomputes `separation_summary`; it takes and
  returns a whole `MidiProjectDto`, mirroring `export_midi`'s existing
  whole-project-DTO convention rather than introducing a new result type.
  Frontend: `commands.ts` gained a matching `reassignVoices` wrapper.
  `App.tsx`'s new "Re-run separation" button (next to "Review flagged
  notes" in the separation-summary banner) sends the _original_ unmodified
  `project.notes` plus the current `voiceOverrides` as `locked`, replaces
  `project` with the response, and folds any new voice ids the backend
  allocated into `voiceOrder` via the new `mergeVoiceOrder` (numeric, not
  lexicographic, sort) so they're visible in the legend instead of only
  rendering color-coded on the canvas with no legend entry.
  `voiceOverrides` is deliberately never cleared after a re-run — it must
  persist as the durable lock record so a _second_ re-run later still
  honors every correction made before the first one.
  **Deferred from the plan, intentionally:** the optional `max_voice_count`
  soft-cap parameter was not added — no UI need for it was established yet,
  and the plan listed it as optional.
  - Verified: `pnpm rust:test` (30/30, including new tests for a locked
    note pulling a nearby unlocked note, new-voice allocation avoiding a
    not-yet-encountered locked id, and the with-locks/without-locks
    equivalence regression), `cargo fmt --check`, `pnpm rust:check`,
    `pnpm rust:clippy -D warnings`, `pnpm test` (65/65, including new
    `commands.test.ts` and `voiceManagement.test.ts` cases), `pnpm lint`,
    `pnpm format:check`, `pnpm build`.
  - Not yet verified: manual `pnpm tauri dev` pass — particularly worth
    checking that re-running after several manual corrections across
    multiple voices doesn't visibly "fight" the user's prior corrections,
    and that the new-voice-in-legend behavior looks right after a re-run
    that needed an extra voice.
  - Next: Phase 7 (undo/redo) — the last phase in the plan.

- **Phase 7 (undo/redo) — done. All 7 plan phases are now complete.** New
  `src/app/editorHistory.ts` is a pure, capped (50-entry) full-snapshot
  undo/redo stack over `{ voiceOverrides, voiceOrder, voiceLabels }` —
  chosen over an operation-diff log because chiptune files are small enough
  (at most a few hundred notes) that snapshotting all three pieces of
  state per action is cheap, and it's much simpler to get right than
  diffing. `pushHistory` appends a snapshot and clears the redo stack (a
  new action invalidates whatever was undone); `undoHistory`/`redoHistory`
  swap the current state with the top of the past/future stack.
  `App.tsx` calls a new `pushHistorySnapshot()` (capturing the
  _pre-mutation_ state) at the start of every action that mutates one of
  the three tracked pieces of state: the keydown handler's bulk
  reassignment, `handleCreateVoice`, `handleMergeVoice`,
  `handleReorderVoice`, and `handlePaintNotes`. Renaming a voice pushes on
  the input's `onFocus` rather than on every `onChange` keystroke, so an
  entire rename is one undo step instead of one per character. `Ctrl+Z` /
  `Ctrl+Shift+Z` (handled before the `Escape` branch in the existing
  keydown effect, so the existing input-focus guard still lets native
  browser undo work inside text fields like the rename input) and new
  header "Undo"/"Redo" buttons both call `handleUndo`/`handleRedo`, which
  read `history` plus the three pieces of state directly from component
  scope (no nested `setState`-inside-`setState` calls) and apply all four
  resulting `setState` calls together.
  **Deliberately out of scope, called out rather than silently
  scope-creeped:** "Re-run separation" (Phase 6) is _not_ undoable. It
  replaces `project` itself (not just the three tracked pieces of state),
  and undoing only `voiceOverrides`/`voiceOrder`/`voiceLabels` back to
  their pre-re-run values while `project.notes` keeps the new heuristic
  assignment would produce a misleading half-reverted state. A real undo
  for re-run would need `project` in the snapshot too — left for a future
  pass if it turns out to matter in practice.
  - Verified: `pnpm test` (71/71, including new `editorHistory.test.ts`
    covering push/cap-depth/undo/redo), `pnpm lint`, `pnpm format:check`,
    `pnpm build`, `pnpm rust:check` (untouched, still clean).
  - Not yet verified: manual `pnpm tauri dev` pass — especially worth
    checking that a multi-character voice rename undoes as one step, that
    a paint stroke undoes as one step (not one per touched note), and that
    Ctrl+Z while focused in the voice-rename text input falls through to
    native input undo instead of the app-level undo.
  - All 7 phases of the original plan are now implemented. Future work
    (pan/zoom viewport, the deferred `max_voice_count` soft cap, undoable
    re-run) would be a new plan, not a continuation of this one.

- **Roadmap Phase 1 (close the testing gap) — done, including the manual
  verification pass deferred since the original Phase 1.**
  - Extracted `resolveNoteRenderStyle` (pure) from `drawPianoRoll.ts`'s
    draw loop — fill/stroke color, selected/dimmed/low-confidence flags,
    given a note plus `{ selectedNoteIds, soloVoiceId, paintPreview }`.
    `drawPianoRoll` now calls it instead of inlining the logic. New tests
    in `drawPianoRoll.test.ts` cover every flag independently and in
    combination (e.g. paint-preview overriding which voice solo-dimming
    checks against).
  - Added `commands/midi.rs` tests (previously zero): `import_midi`/
    `export_midi` empty-path and bad-extension rejection, a real
    `import_midi` round-trip against `fixtures/two-note-smoke.mid`, an
    `export_midi` round-trip that writes to `std::env::temp_dir()` and
    cleans up after itself, and a `reassign_voices` test exercising the
    full command function (not just `assign_heuristic_voices_with_locks`
    underneath it).
  - Added `importMidi.test.ts`/`exportMidi.test.ts` for
    `selectAndImportMidi`/`selectAndExportMidi`, mocking
    `@tauri-apps/plugin-dialog`'s `open`/`save` the same way
    `commands.test.ts` already mocks `invoke`. Covers dialog-cancel
    (returns `null`, never calls the underlying command) and
    `exportMidi.ts`'s previously-untested `defaultExportName` `-voices.mid`
    suffixing for both `.mid` and `.midi` source names.
  - Deliberately did not add `jsdom`/React Testing Library for `App.tsx`/
    `PianoRoll.tsx` — see the roadmap plan file for the reasoning. Closed
    that gap instead by actually running the app (next bullet).
  - **Executed the manual verification pass.** No `tauri-driver`/WebDriver
    setup exists for this project, so real native-window automation
    wasn't available; instead, faked the Tauri IPC boundary
    (`window.__TAURI_INTERNALS__.invoke`, matching `@tauri-apps/api/core`'s
    `invoke(cmd, args)` → `window.__TAURI_INTERNALS__.invoke(cmd, args)`
    contract, plus `plugin:dialog|open`/`plugin:dialog|save` for the
    dialog plugin) and drove the **real** Vite dev server bundle
    (`pnpm tauri dev`'s `localhost:1420`) with Playwright/Chromium. This
    exercises the actual production frontend code, not a reimplementation
    — only the native OS boundary (file dialog, Rust IPC) is substituted.
    Confirmed working end-to-end with zero browser console errors: marquee
    multi-select ("5 notes selected | 2 voices..."), bulk `1`-`9`
    reassignment, voice create/rename/solo (with correct dimming),
    confidence banner text and dashed low-confidence outlines (visually
    confirmed in screenshots), `Tab` review-stepping landing on a
    different flagged note each time, paint-mode drag actually reassigning
    notes crossed by the stroke, "Re-run separation" updating the
    confidence banner, voice rename + `Ctrl+Z`/`Ctrl+Shift+Z` round-
    tripping the label, and export producing the success banner.
  - **Two real findings from actually running it** (neither is a
    regression — both are existing, working-as-coded behavior worth
    knowing about):
    1. "+ New voice" assigns the _current selection_ to the new voice if
       one is active (`handleCreateVoice` in `App.tsx`) — and selection is
       **not** cleared by a prior `1`-`9` bulk reassignment. So
       marquee-select-all → press `1` → click "+ New voice" moves
       everything into the brand-new voice, not voice 1, because the same
       5-note selection was still active. This is the documented Phase 2
       behavior working correctly, but it's easy to trip over in a real
       editing session — worth keeping in mind, not a bug to fix.
    2. `.voice-name-input` (`global.css`) is a fixed `width: 72px` with no
       `text-overflow: ellipsis` — a label longer than that (e.g. "Renamed
       Voice") visually clips mid-character with no ellipsis cue, even
       though the underlying input value is correct (confirmed via
       `inputValue()`, not just the rendered text). Minor, cosmetic, real
       — candidate for a follow-up CSS tweak (`text-overflow: ellipsis`
       at minimum, or a wider/auto-growing input).
  - Verified: `pnpm test` (86/86 — up from 71, all new tests above),
    `pnpm lint`, `pnpm format:check`, `pnpm build`, `pnpm rust:test`
    (37/37 — up from 30), `pnpm rust:clippy -D warnings`,
    `cargo fmt --check`, plus the from-scratch manual pass described
    above (scratch driver script and screenshots were not committed —
    they were temporary verification scaffolding, not part of the app).
  - Next: roadmap Phase 2 (README catch-up), or pick from Phase 3/4/5/6.

- **Roadmap Phase 2 (README catch-up) — done.** `README.md` no longer
  describes the pre-Phase-1 "first milestone" (single-note selection, no
  voice management, no confidence scoring). Rewrote "Current capabilities"
  to list everything through the 7-phase plan plus roadmap Phase 1's
  testing work, "Non-capabilities" to add the pan/zoom and
  undoable-re-run gaps (in addition to the still-true playback/DAW/audio-
  separation/ML deferral), the "Architecture" section's voice-assignment
  paragraph to describe the cost-based heuristic and locked re-run instead
  of the old single-pass nearest-pitch description, and "Next milestone"
  to point at the roadmap's remaining phases (pan/zoom, playback, the two
  deferred items) instead of the now-long-done "multi-note selection."
  `agents.md` remains the detailed agent-facing history; `README.md` is
  the human-facing summary and intentionally doesn't duplicate the
  Progress Log's level of detail.
  - Verified: `npx prettier --check README.md`; proofread against this
    Progress Log section by section per the roadmap plan's verification
    note.
  - Next: roadmap Phase 3 (the two deferred items), Phase 4 (pan/zoom),
    Phase 5 (playback — scope as its own plan), or Phase 6 (performance
    validation).

- **Roadmap Phase 3 (the two deferred items) — done.**
  - **3a, `max_voice_count` soft cap.** `assign_heuristic_voices_with_locks`
    in `voice_assignment.rs` gained a third parameter,
    `max_voice_count: Option<usize>` (the unlocked wrapper
    `assign_heuristic_voices` still calls it with `None`, unchanged
    behavior). `compatible_candidates` was generalized into
    `score_candidates(voices, note, require_compatible: bool)` so the same
    scoring logic can run with or without the overlap filter. When an
    unlocked note has no compatible (non-overlapping) voice **and** the
    cap is already reached (`voices.len() >= max`, and at least one voice
    already exists — the very first voice is always allowed regardless of
    cap), it's forced into the lowest-cost existing voice anyway via
    `score_candidates(..., false)`, rather than opening a new one. This is
    a deliberate trade-off documented on the function: the voice now holds
    two overlapping notes. New `AssignmentReason::VoiceCapReached` with
    confidence `0.0` marks these, so a forced-overlap assignment always
    surfaces in review mode rather than silently happening. Locked notes
    are exempt from the cap entirely — a hard user constraint should never
    be denied because of a soft heuristic cap. One subtlety: the shared
    post-match code that updates `voice.last_end_tick` normally overwrites
    it with `note.end_tick`; for the forced-overlap case specifically it
    now takes `.max(note.end_tick)` instead, since a forced-overlap note
    was never guaranteed to end after the voice's true latest note.
    `reassign_voices` (`commands/midi.rs`) and `commands.ts`'s
    `reassignVoices` both gained the matching `max_voice_count`/
    `maxVoiceCount` parameter (sent as `null` when unset, since
    `serde`/Tauri need an explicit `Option` on the Rust side rather than a
    missing key). `App.tsx` added a small "Max voices" number input next
    to "Re-run separation" (blank/`auto` = no cap), parsed defensively
    (non-positive or non-integer input is treated as no cap, not an
    error).
  - **3b, undoable re-run.** `EditorSnapshot` in `editorHistory.ts` now
    includes `project: MidiProject | null` alongside the three
    already-tracked pieces of state, made non-optional (every snapshot
    everywhere now captures all four fields together) rather than the
    plan's originally-suggested "optionally include project" — simpler,
    since conditional restore logic would have been more complex than
    just always carrying the field. `handleReassign` now calls the same
    `pushHistorySnapshot()` every other mutating action uses, right after
    a successful `reassignVoices` call but before `setProject` applies the
    result (so the snapshot captures the _pre_-reassign project via
    closure, and a failed reassign no longer pollutes the undo stack with
    a no-op entry).
  - Verified: `pnpm rust:test` (41/41, including new
    `voice_cap_forces_reuse_instead_of_opening_a_new_voice`,
    `voice_cap_still_allows_the_very_first_voice`,
    `voice_cap_does_not_block_locked_notes`, and a
    `reassign_voices_respects_the_max_voice_count_cap_through_the_command`
    command-level test), `cargo fmt --check`, `pnpm rust:check`,
    `pnpm rust:clippy -D warnings`, `pnpm test` (87/87, including updated
    `commands.test.ts` cases for the new `maxVoiceCount` argument),
    `pnpm lint`, `pnpm format:check`, `pnpm build`.
  - Not yet verified: manual `pnpm tauri dev` pass for the new "Max
    voices" input and for confirming a `Ctrl+Z` right after "Re-run
    separation" genuinely restores the prior project state (notes, voices,
    and separation summary all reverted together).
  - Next: roadmap Phase 4 (pan/zoom), Phase 5 (playback — scope as its own
    plan), or Phase 6 (performance validation).

- **Pitch range marker slice — in progress.** Added the first usable range-based
  correction path requested by the user: two pitch markers are seeded on import
  via `buildDefaultPitchMarkers`, rendered as draggable orange marker handles in
  the piano-roll label gutter, and exposed in a compact `Pitch ranges` panel.
  `rangeRules.ts` owns the pure range model (`PitchMarker`, `VoiceRangeRule`) and
  builds an override patch from the default rule order: above Marker 1 -> voice
  1, Marker 2 through Marker 1 -> voice 2, and below Marker 2 -> voice 3 when
  those voices exist. `App.tsx` applies that patch by merging into the existing
  `voiceOverrides` map after `pushHistorySnapshot()`, so the operation is
  undoable and export continues to use the already-derived `displayedProject`.
  Manual correction still happens afterward through the existing select/number
  and paint-mode paths; reapplying ranges intentionally overwrites matching
  notes because the app does not yet track provenance for range-generated vs.
  hand-edited overrides.
  - Files touched so far: `src/domain/midi/rangeRules.ts`,
    `src/domain/midi/rangeRules.test.ts`, `src/app/App.tsx`,
    `src/features/piano-roll/PianoRoll.tsx`,
    `src/features/piano-roll/drawPianoRoll.ts`, `src/styles/global.css`,
    and this `agents.md` note.
  - Verified: `pnpm test` (116/116), `pnpm lint`, `pnpm build`, and
    `pnpm format:check`.

- **Roadmap Phase 4 (piano roll pan/zoom) — done.** New
  `viewportWindow.ts` (see Code Map) is the pure pan/zoom model; it's
  horizontal-only (time axis) by design — the pitch axis still auto-fits
  to the note range as before, since the documented limitation was
  specifically about the timeline being squashed into the canvas width,
  not pitch. `drawPianoRoll.ts`'s `buildViewport` gained an optional
  `tickWindow` parameter (defaults to the old full-project-span behavior
  when omitted, so every existing call site/test stayed correct
  unchanged); the beat-gridline loop was also fixed to start at the
  nearest beat at-or-before the visible window instead of
  unconditionally at tick 0, since looping from the project start on
  every frame would scan far more beats than are ever drawn once a
  zoomed-in sub-window is possible. `PianoRoll.tsx` owns a
  `viewportWindow` state, reset only when `project.durationTicks`
  changes (i.e. a genuinely new import — corrections replace `project`
  with a new object reference but never change duration, so zoom/pan
  intentionally survives every correction). Ctrl/Cmd+wheel zooms
  anchored at the cursor tick; plain wheel pans; a "Reset zoom" button
  appears once zoomed; a thin clickable minimap bar shows the current
  window against the full duration. Most importantly, this phase closes
  the loop on the original motivating complaint: a new effect watches
  `selectedNoteIds` and auto-pans (never auto-zooms, so it doesn't fight
  the user's chosen zoom level) to reveal a single keyboard-selected
  note — so `Tab`-stepping through flagged notes (Phase 4 of the
  original plan) now actually scrolls a long file into view instead of
  just selecting an off-screen note.
  **Bug caught only by manually driving the running app, not by unit
  tests:** React's `onWheel` JSX prop attaches the underlying native
  listener as passive, so `event.preventDefault()` inside it is silently
  ignored — the browser's native scroll/zoom would still have fired
  alongside ours in the real app (confirmed via 27
  `"Unable to preventDefault inside passive event listener invocation"`
  console errors during the verification pass below). Fixed by attaching
  a real `wheel` listener directly via `canvas.addEventListener("wheel", handler, { passive: false })`
  in a `useEffect` instead of the JSX prop. This is exactly the kind of
  bug the recurring "manual pass" exists to catch — no unit test would
  have exercised the browser's passive-listener semantics.
  - Verified: `pnpm test` (104/104 before the range-rules slice landed
    concurrently, 116/116 after merging with it), `pnpm lint`,
    `pnpm format:check`, `pnpm build`, `pnpm rust:check` (untouched).
    Manually drove the real running app (same faked-IPC Playwright
    technique as roadmap Phase 1) for Ctrl+wheel zoom anchoring, plain-
    wheel pan, the minimap, the reset button, and review-mode auto-pan
    onto an off-screen flagged note — all confirmed working visually via
    screenshots, with zero console errors after the passive-listener fix.
  - Next: roadmap Phase 5 (playback — scope as its own plan) or Phase 6
    (performance validation on real dense files).

- **Roadmap Phase 5 (MIDI playback) — done.** Got its own dedicated plan
  first (per the roadmap's recommendation, given its size relative to
  every other phase) before implementation — see Code Map above for the
  new `tempoMap.ts` and `src/features/playback/` files. Frontend-only: no
  Rust/Tauri changes, since Web Audio runs entirely in the WebView.
  Square/triangle/sawtooth oscillator synthesis cycling by voice index (no
  sample playback/soundfont) — simple and on-theme. All of a play-from-tick
  call's notes are scheduled up front via Web Audio's own sample-accurate
  scheduling (not a rolling lookahead scheduler) — correct and simple at
  chiptune-file scale. Respects the existing `soloVoiceId` (only the
  soloed voice is audible) instead of adding new per-voice mute UI. The
  existing minimap (Phase 4) is now also a playback seek control —
  clicking it pans the view (existing behavior) and calls the new
  `onSeek` prop. `PianoRoll.tsx` draws the playhead
  (`drawPianoRoll.ts`'s new `playheadTick` parameter) and page-follows it
  during playback by reusing Phase 4's `panToReveal`, the same way
  review-mode Tab-stepping already does — only while `isPlaying`, so a
  paused/stopped playhead doesn't fight a manual scroll. Play/Pause/Stop
  and a `mm:ss / mm:ss` readout live in `App.tsx`'s existing
  `.piano-roll-toolbar` section, next to the Paint-mode/Range-markers
  toggles. **Real Web Audio gotcha caught before it could bite**: a
  freshly-created `AudioContext` can be left `"suspended"` by the
  browser's autoplay policy even when constructed inside a user-gesture
  handler (the Play button's click) — `playbackEngine.ts` explicitly
  calls `context.resume()` when suspended, otherwise playback would
  silently produce no sound rather than erroring.
  - Verified: `pnpm test` (142/142, including new `tempoMap.test.ts`,
    `frequency.test.ts`, `scheduledNotes.test.ts`, and
    `formatPlaybackTime.test.ts`), `pnpm lint`, `pnpm format:check`,
    `pnpm build`, `pnpm rust:check`/`rust:clippy`/`cargo fmt --check`
    (all untouched, still clean — no Rust files changed this phase).
    Manually drove the real running app (same faked-IPC Playwright
    technique as Phases 1 and 4): Play/Pause/Stop, the time readout
    advancing while playing and freezing while paused, resuming from the
    paused tick instead of restarting, minimap-click seeking both the
    view and the readout, and Solo-then-Play running without errors —
    all with zero console errors. **Stated limitation, as planned**: this
    confirms the engine runs and schedules without erroring and that UI
    state is correct, but cannot verify the audio actually _sounds_
    correct (right pitches, no clipping) without a human listening.
  - All items in the original "where to go from here" roadmap are now
    complete except Phase 6 (performance validation on real dense files),
    which was never blocked on anything else and can be picked up
    independently whenever real chiptune fixtures are available to test
    against.

- **Roadmap Phase 6 (performance validation on real dense files) — done.
  This completes the entire roadmap.** No real dense chiptune `.mid` file
  exists in `fixtures/`, so validated against synthetic data at a
  realistic-and-beyond scale instead, the same way every other phase's
  manual pass already worked (faked-IPC Playwright for the frontend; for
  Rust, a temporary `#[ignore]`d timing test, run once via
  `cargo test --release ... -- --ignored --nocapture` and then deleted —
  scratch code, not a permanent addition, since this phase is a
  measurement, not new functionality).
  - **Rust**: `assign_heuristic_voices` on 2000 overlapping notes forced
    into 48 simultaneous voices (worst case for the O(notes × voices) cost
    model — a monophonic 2000-note run was tried first and degenerated to
    1 voice, so it was rebuilt as 16-wide advancing chords to actually
    stress candidate-scoring) took **392.5µs**. No performance concern
    whatsoever at any realistic chiptune scale.
  - **Frontend**: a synthetic 600-note, 6-voice, 86-flagged-note project
    (chiptune-scale and then some) driven through marquee-select-all,
    bulk reassign, a paint-mode drag stroke, 20 Tab-steps through flagged
    notes, 10 Ctrl+wheel zoom notches, 20 plain-wheel pans, a "Re-run
    separation" call, and a second of Play — every single operation
    completed in under 700ms end-to-end (most under 500ms), including
    Playwright's own dispatch overhead. No throttling or memoization was
    added, per the plan's "only optimize if the pass actually shows a
    problem" — it didn't.
  - **Real bug found by this pass, unrelated to performance**: the
    Phase-4 minimap (`.piano-roll-minimap`, `top: 0; height: 6px; z-index: 1`)
    sits on top of the canvas's first 6 logical pixels. A marquee drag
    _starting_ inside that 6px band lands on the minimap instead of the
    canvas — the minimap's own `onPointerDown` (`handleMinimapClick`)
    fires instead of the canvas's, so `dragStartRef.current` never gets
    set and the gesture silently does nothing (no error, just no
    selection). Confirmed via direct pixel-sampling and DOM
    `elementFromPoint` inspection that this was a real interaction gap,
    not a test-script targeting mistake, before concluding it — moving
    the marquee's start point a few pixels lower immediately fixed it.
    **Left as-is, not fixed**, since it's a narrow, low-probability edge
    case (a user would have to start a drag in literally the top 6
    pixels of the roll) and this phase's mandate was measurement, not
    new fixes — noting it here as a candidate for a future tiny
    polish pass (e.g. starting the canvas's own hit-test area below the
    minimap strip, or giving the minimap a `pointer-events: none` zone
    outside its own narrow drag handle).
  - Verified: `pnpm test` (142/142, unchanged — no new permanent code),
    `pnpm lint`, `pnpm format:check`, `pnpm build`, `pnpm rust:test`/
    `rust:clippy`/`cargo fmt --check` (all clean, `voice_assignment.rs`
    confirmed back to its pre-investigation state — the scratch timing
    test and temporary debug `console.log`s in `PianoRoll.tsx` were both
    removed after use, not committed).

This completes every phase of both the original 7-phase plan and the
follow-on roadmap. Future work (the minimap edge case above, a
performance pass against a _real_ dense `.mid` file if one becomes
available, or any of the README's "Next milestone" candidates) would
start a new plan.

### Pitch-range provenance tracking — done

Picked up the other README "Next milestone" candidate: reapplying
pitch-range rules (after nudging a marker) used to blindly overwrite
every matching note's override, including notes a user had since
hand-corrected by number-key reassignment, paint, or merge — silently
discarding that correction.

- Added `applyRangePatchPreservingHandCorrections` to `rangeRules.ts`:
  a pure function that merges a freshly computed range patch into the
  current override map, but skips a note if it already has an
  override that the _previous_ range application didn't itself write
  (i.e. someone hand-corrected it since). Notes the patch newly
  assigns become range-controlled themselves, so a later reapply can
  still adjust them — provenance isn't permanent, only "since the last
  apply."
- `App.tsx` now carries a `rangeAssignedNoteIds` set alongside
  `voiceOverrides`, tracking which override entries the last pitch-range
  apply wrote. Every other override-writing action (number-key
  reassign, paint, merge, create-voice-from-selection) removes the
  notes it touches from that set, marking them hand-corrected.
  `handleApplyPitchRanges` runs the new merge function instead of a
  blind object spread.
- `rangeAssignedNoteIds` joins `EditorSnapshot` in `editorHistory.ts`
  so undo/redo restores provenance correctly, not just the override
  values — otherwise undoing past a range-apply could leave a note
  marked range-controlled when it shouldn't be (or vice versa).
- A fresh import resets `rangeAssignedNoteIds` to empty, same as every
  other per-project correction state.
- New tests in `rangeRules.test.ts` cover: no prior overrides (patch
  applies normally), reapplying onto previously range-assigned notes
  (still applies), skipping a hand-corrected note while still applying
  to untouched notes in the same patch, and leaving untouched
  range-assigned notes alone when a later patch doesn't mention them.
- Hit one build error along the way: `Object.hasOwn` isn't available
  at this project's TS lib target; switched to
  `Object.prototype.hasOwnProperty.call` instead of bumping the lib
  target for one call site.
- Verified: `pnpm test` (146/146, 4 new), `pnpm lint`, `pnpm format:check`,
  `pnpm build` all clean. No Rust changes — this is frontend-only
  override bookkeeping, so the Rust suite wasn't re-run.

### Minimap/marquee top-6px overlap — fixed

The last open item from Phase 6 (see above): the Phase-4 minimap
overlaid the canvas's top 6 logical pixels with `position: absolute;
top: 0; z-index: 1`, so a marquee drag starting there hit the
minimap's `onPointerDown` instead of the canvas's, silently producing
no selection.

- Fix: gave `.piano-roll-shell` a `padding-top: 6px` in
  `global.css`, so the minimap (still `position: absolute; top: 0`)
  now sits in that reserved padding band, and the canvas — a normal
  flow child, sized off the container's `ResizeObserver` content-box
  rect, which already excludes padding — starts right below it. The
  two regions no longer overlap, so there's nothing left to fight over
  pointer events; no JS/TSX changes were needed; `PianoRoll.tsx`'s
  coordinate math is already canvas-relative via
  `getBoundingClientRect()`, so it picked up the new offset for free.
- Verified with a throwaway Playwright script (faked Tauri IPC, real
  dev-server bundle, same technique as every other manual pass): built
  a 60-note/3-voice synthetic fixture, confirmed a marquee drag
  starting at the canvas's old y+2 (inside the former danger zone)
  now selects the same 12 notes as an identical drag starting at
  y+30, and that the minimap (now measured 6px above the canvas, not
  overlapping it) still seeks/pans on click with zero console errors.
  Script and its npx-cache copy were both deleted after use, not
  committed.
- Verified: `pnpm test` (146/146, unchanged), `pnpm lint`,
  `pnpm format:check`, `pnpm build` all clean. No Rust changes.

This closes every item from the original 7-phase plan, the follow-on
roadmap, and both of the README's former "Next milestone" candidates.
No open work is currently tracked; a new task would start a new plan.

### Created MANUAL_TEST_CASES.md

A checklist of every implemented use case (import, viewing, selection,
bulk reassignment, voice management, review mode, paint mode,
pitch-range mode, re-run separation, undo/redo, pan/zoom, playback,
export, cross-cutting edge cases), grouped by feature area, for manual
`pnpm tauri dev` verification passes. No code changes.

### Stale empty voices after "Re-run separation" with a lower max-voice cap — fixed

User report: lowering "Max voices" to 4 and re-running appeared to
only use 2 voices, with most of the rest "visible but empty." Used the
user-provided real fixture (`midi-files/egypt - chiptune.mid`, 2328
notes, 22-note max polyphony) to investigate with a throwaway
`#[ignore]` Rust test before concluding anything:

- The Rust heuristic itself is correct: capping at 4 against this real
  file produces exactly 4 distinct voice ids in use, not 2 — confirmed
  via `assign_heuristic_voices_with_locks`, both `voices.len()` and the
  actual distinct `voice_id`s on the notes. The cap logic (Phase 3 of
  the original roadmap) has no bug.
- The actual bug is in the frontend's voice bookkeeping:
  `handleReassign` (`App.tsx`) updated `voiceOrder` with
  `mergeVoiceOrder`, which only appends new ids and never removes ones
  that no longer have notes. A full re-run, unlike incremental
  corrections, redetermines the entire voice structure — any
  previously-existing voice id the new result doesn't use anymore
  should drop out of the legend, not linger as a 0-note row forever.
  That's what produced the "visible but empty" voices the user saw;
  the piano roll canvas itself was already correct (it draws from
  actual note `voiceId`s, not `voiceOrder`), so the confusing legend
  was likely what made the canvas seem wrong too.
- Fix: added `reconcileVoiceOrderAfterReassign(voiceOrder,
noteVoiceIds)` to `voiceManagement.ts` — appends brand-new ids like
  `mergeVoiceOrder` still does, but also filters the result down to
  only ids actually present in `noteVoiceIds`. `handleReassign` now
  calls this instead of `mergeVoiceOrder`. Every other caller of voice
  order updates (create voice, merge, paint, reassign-by-number) is
  untouched, since those are incremental corrections where pruning
  would be wrong (e.g. creating an empty voice on purpose).
- 4 new tests in `voiceManagement.test.ts`: drops unused ids, appends
  new ones, preserves relative order for survivors, and handles the
  all-notes-gone-empty-order edge case.
- Verified: `pnpm test` (150/150, 4 new), `pnpm lint`,
  `pnpm format:check`, `pnpm build`, `pnpm rust:test` (41/41,
  confirmed back to its pre-investigation count — the scratch
  `#[ignore]` test was deleted after use, not committed),
  `pnpm rust:clippy`, `cargo fmt --check` all clean.
- Follow-up: the user's "still only 2 voices" follow-up turned out to
  be a misread of the already-correct 2-column legend grid (all 4
  voices were there, just side-by-side in pairs) — no further bug.

### Collapsible piano-roll legend

While investigating the above, the user noted the "Voices" panel
(color swatches + labels) lives well above the piano roll and scrolls
out of view, making it easy to lose track of which color is which
voice — exactly what caused the legend misread. Added a small overlay
legend directly on the canvas:

- `PianoRoll.tsx`: new `isLegendCollapsed` local state (ephemeral UI
  state, not part of undo/redo or `EditorSnapshot` — it's a per-session
  display preference, not corrigible project state). Renders a
  `.piano-roll-legend` div in the shell's bottom-right corner (the
  reset-zoom button already owns the top-right), listing every
  `project.voices` entry with its swatch color from `drawPianoRoll.ts`'s
  exported `getVoiceFillColor` — the same function the canvas itself
  uses, so the legend's colors are guaranteed to match what's drawn,
  not a separately-maintained, potentially-divergent color source (the
  existing `App.tsx` voice-swatch legend uses a CSS-variable-by-list-
  index scheme instead; this one deliberately doesn't, to stay tied to
  the canvas's actual per-note color).
- A toggle button collapses it to just a `Voices ▸`/`▾` header, per the
  request that it not get in the way.
- `global.css`: `.piano-roll-legend` and related styles, positioned
  absolute with a max-height scrolling list for projects with many
  voices.
- No new unit tests — this is presentational glue in the same
  untested-by-convention category as `PianoRoll.tsx`'s pointer-event
  handling (see Architecture Invariants below); verified instead with
  a throwaway Playwright script (faked Tauri IPC, real dev-server
  bundle) confirming the legend renders with correct colors/labels and
  the collapse toggle works, then deleted, not committed.
- Verified: `pnpm test` (150/150, unchanged), `pnpm lint`,
  `pnpm format:check`, `pnpm build` all clean. No Rust changes.

### Register-aware voice assignment cost (heuristic drift)

User report: re-running on `midi-files/egypt - chiptune.mid`, a single
voice held both pitch 28 and pitch 91 (a 5+ octave span) with other
voices interleaved in the pitch range between them — clearly not the
intended "separate musical lines" outcome. Asked the user how they'd
like it fixed; they chose adding a register-aware cost term over a
rolling-average alternative.

- Root cause, confirmed against the real fixture before changing
  anything: the cost model in `voice_assignment.rs` only scores a
  candidate voice against its _last_ note's pitch, with no penalty for
  how far that note is from the voice's overall established range.
  A melodic line can therefore drift across the full pitch range one
  cheap small step at a time — no single step looks wrong, but the
  voice ends up spanning octaves. Made worse by the fact the source
  file's channel 0 alone holds 1671 of 2328 notes spanning pitch 24-95
  (channels aren't a reliable separation signal for this file either,
  so the heuristic has to do real work here).
- Fix: `score_candidates` now adds `register_distance *
REGISTER_DRIFT_WEIGHT` to the cost, where `register_distance` is how
  far a note falls outside a voice's `[lowest_pitch, highest_pitch]`
  envelope (0 if already inside it) — using the `VoiceState` fields
  already tracked for the voice-summary legend. Skipped entirely for
  voices with fewer than `REGISTER_ESTABLISHED_NOTE_COUNT = 2` notes,
  since a 1-note voice's "range" is just its last note's pitch and
  would otherwise double-count plain pitch distance — this is what let
  `REGISTER_DRIFT_WEIGHT` go as high as `1.5` (an earlier, naive version
  without the note-count guard had to stay below `0.5` to avoid
  flipping `channel_continuity_outweighs_pure_pitch_proximity`, which
  was nowhere near enough to matter against real data).
- New test `register_drift_prefers_a_voice_already_covering_the_pitch_over_a_nearer_last_note`:
  constructs (via locks, to set up state deterministically) a voice
  that's drifted across 40-90 but whose _last_ note sits at 40, plus a
  tight 66-68 voice whose last note (68) is numerically closer to a new
  pitch-88 note than 40 is. Plain last-pitch distance would pick the
  tight voice (and stretch it further); the register-aware cost picks
  the wide voice instead, since 88 already falls inside its established
  range.
- **Measured effect, honestly**: re-ran the same channel/voice-span
  analysis used to diagnose this. Uncapped on the real fixture, the
  weight change shifted the _distribution_ (several voices got much
  tighter — e.g. one dropped from a 51-semitone span to 10) but barely
  moved the _worst case_ (max span 67 → 58), because once two voices
  are both "compatible" (non-overlapping) candidates the term can only
  pick the better of the available options — it can't invent a third
  option, and at the user's actual repro setting (max voices capped at
  4 against this file's true ~22-note polyphony) all 4 voices still
  end up spanning 65-71 semitones regardless of cost-model tuning,
  because 4 containers mathematically cannot hold ~22 simultaneous
  musical lines without some container absorbing very different
  pitches at different times. Reported this to the user rather than
  overstating the fix — the register term helps the heuristic make
  better choices when there's room to choose, but a tight cap on a
  highly polyphonic file is a capacity problem, not a tuning problem.
- Verified: `pnpm rust:test` (42/42, 1 new), `pnpm rust:clippy`,
  `cargo fmt --check`. `pnpm test`/`lint`/`format:check`/`build` for the
  frontend re-run for safety (150/150, all clean) though nothing
  frontend-facing changed.

### Separation strategy selector

Direct follow-up to the register-aware tuning above. Investigated
further at the user's cap=8 repro (screenshot showed one voice's notes
scattered across the full pitch range): broke voice-4's 337 notes down
by `assignment_reason` and found only 12% were the forced
`VoiceCapReached` path — 88% were "normal" scored assignments that
still chose to spread across registers. Root cause: this file's
channel 0 holds 72% of all notes, so the channel-continuity bonus is
satisfied for almost every candidate and stops being a useful
discriminator, leaving pitch/register distance to do work that isn't
strong enough by itself at this density. Concluded no single fixed
weighting was going to separate this file well, and rather than keep
tuning blind, planned and built a strategy selector (full plan at
`C:\Users\davej\.claude\plans\sequential-watching-sprout.md` before
this entry, since it's a real feature with a few file touches, not a
one-line fix).

- `src-tauri/src/midi/model.rs`: new `SeparationStrategy` enum
  (`Balanced | ChannelPriority | RegisterPriority | StrictChannel`),
  `SCREAMING_SNAKE_CASE` over the wire, matching `AssignmentReason`'s
  existing convention in the same file.
- `src-tauri/src/midi/voice_assignment.rs`: the three weights
  `score_candidates` combines (`gap_weight`, `channel_continuity_bonus`,
  `register_drift_weight`) are now a `CostWeights` struct instead of
  top-level constants, with `SeparationStrategy::cost_weights()` holding
  one preset per strategy. `Balanced` is today's exact numbers (so every
  existing test's expectations hold unchanged); `ChannelPriority` raises
  the channel bonus to 12; `RegisterPriority` raises the register weight
  to 4 and drops the channel bonus to 1; `StrictChannel` raises the
  channel bonus to 1000 (channel wins whenever a same-channel compatible
  voice exists at all — "one voice per channel" without a second
  algorithm, reusing the exact same scoring path). `REGISTER_ESTABLISHED_NOTE_COUNT`,
  `GAP_NORMALIZATION_TICKS`, `CONFIDENCE_SCALE`, `LOW_CONFIDENCE_THRESHOLD`
  stay global, unaffected by strategy. `assign_heuristic_voices_with_locks`
  gained a `strategy` parameter; `assign_heuristic_voices` (the
  no-locks wrapper `parser.rs` uses on fresh import) keeps its old
  signature, always passing `Balanced` — import behavior is unchanged.
- New test `separation_strategy_changes_which_voice_a_note_lands_in`:
  builds one scenario (a channel-1 voice last at pitch ~80, a
  channel-0 voice with an established 38-42 range) where a pitch-60,
  channel-1 test note is a near-tie, then runs it twice — once under
  `ChannelPriority` (lands in the channel-matching voice) and once
  under `RegisterPriority` (lands in the register-matching voice) —
  proving the strategies don't just produce different numbers, they
  pick genuinely different voices.
- `src-tauri/src/commands/midi.rs`: `reassign_voices` gained a
  `strategy: SeparationStrategy` parameter, threaded straight through.
  The 2 existing tests that call it directly now pass
  `SeparationStrategy::Balanced` to preserve their assertions.
- 8 existing direct calls to `assign_heuristic_voices_with_locks` in
  `voice_assignment.rs`'s test module got a trailing
  `SeparationStrategy::Balanced` argument (mechanical, via `sed` —
  every one of those tests' expectations was written against today's
  weights).
- `src/lib/tauri/commands.ts`: new exported `SeparationStrategy` union
  type; `reassignVoices` gained a required `strategy` parameter,
  included in the `invoke` payload alongside the existing
  `maxVoiceCount`.
- `src/app/App.tsx`: new `separationStrategy` state (a UI preference
  like `maxVoiceCountInput` — not part of `EditorSnapshot`/undo
  history, only the _result_ of re-running is undoable). New `<select>`
  next to the existing "Max voices" input in
  `.separation-summary-actions`, four plain-language options. `handleReassign`
  passes it through.
- `src/styles/global.css`: `.separation-strategy-label`/`-select`,
  matching the existing `.max-voice-count-label`/`-input` styling.
- `src/lib/tauri/commands.test.ts`: updated the 2 existing
  `reassignVoices` tests for the new required argument and payload
  shape.
- Verified: `pnpm rust:test` (43/43, 1 new), `pnpm rust:clippy`,
  `cargo fmt --check`, `pnpm test` (150/150), `pnpm lint`,
  `pnpm format:check`, `pnpm build` all clean. Also confirmed the
  frontend wiring end-to-end with a throwaway Playwright script (faked
  Tauri IPC, real dev-server bundle): all 4 strategy options render in
  the `<select>`, and choosing "Register priority" then clicking
  "Re-run separation" sends `strategy: "REGISTER_PRIORITY"` through to
  the captured `reassign_voices` invoke payload exactly as expected.
  Script deleted after use, not committed. **Stated limitation**: this
  confirms the Rust scoring logic (via the new unit test) and the
  frontend-to-command wiring (via the faked-IPC pass) independently,
  but doesn't drive the actual native window end-to-end — no
  WebDriver is configured for this project (per the existing
  Architecture Invariant on native dialogs/manual verification
  points). The user's own live `pnpm tauri dev` session auto-rebuilt
  and restarted after these changes (confirmed via process start time
  vs. source file mtimes), so the live app has them active for a
  direct visual check against the real fixture.

### Expanded voice color palette (6 → 12)

User feedback while manually validating the strategy selector: with 8
voices, multiple voices shared a color, since `VOICE_COLORS`/
`VOICE_STROKES` in `drawPianoRoll.ts` only had 6 entries and
`voiceColorIndex` wraps with `% VOICE_COLORS.length`.

- Extended both arrays to 12 entries (added orange, lime, cyan, indigo,
  fuchsia, teal to the existing sky/violet/emerald/amber/rose/pink),
  keeping the first 6 values unchanged so existing low-voice-count
  projects see no color shift.
- Mirrored the same 12 colors into `global.css`'s `--voice-1`
  through `--voice-12` (previously only 1-6), and bumped `App.tsx`'s
  voice-swatch modulo from `% 6` to `% 12` to match. These two color
  sources (canvas/legend by `voiceColorIndex(voiceId)`, the "Voices"
  panel swatch by list index) were already independent before this
  change — not unified here, since that's a bigger pre-existing
  inconsistency the user didn't ask to fix, just kept both palettes the
  same size.
- `waveformForVoice` (`scheduledNotes.ts`) still cycles
  `% WAVEFORMS.length` (3) independently of the color array length, so
  playback timbre assignment is unaffected.
- Updated the one test that asserted the old 6-color wraparound
  (`voice-7` → back to color 0) to wrap at `voice-13` instead, and
  added a test asserting all 12 colors are distinct.
- Verified with a throwaway Playwright script + screenshot (8 synthetic
  voices, faked Tauri IPC, real dev-server bundle): confirmed visually
  that all 8 voices render in distinct colors in both the canvas and
  the new bottom-right legend, then deleted the script, not committed.
- Verified: `pnpm test` (151/151, 2 new in `drawPianoRoll.test.ts`),
  `pnpm lint`, `pnpm format:check`, `pnpm build` all clean. No Rust
  changes.

### Vertical (pitch) zoom and pan

User request: on a file with a wide pitch range, note rows render too
thin to read or click precisely, since the piano roll always rendered
the entire project's pitch span regardless of horizontal zoom. Planned
first (`EnterPlanMode`) since this touches several files and needed a
real UX decision; asked the user how vertical zoom should be
triggered — chose mirroring the existing horizontal scheme exactly,
with `Shift` meaning "vertical instead of horizontal."

- New `src/features/piano-roll/pitchViewportWindow.ts`, structurally
  identical to `viewportWindow.ts` (`{ zoomLevel, panPitch }`,
  `visiblePitchRange`, `zoomPitchAt`, `panPitchBy`/`panPitchTo`,
  `panPitchToReveal`) but resolved against a project's pitch span
  instead of its tick duration. Two things don't carry over directly
  from the tick version: `MAX_PITCH_ZOOM_LEVEL = 16` (not 64 — pitch
  spans are far smaller than tick durations, so the same relative
  headroom would zoom into a fraction of a semitone), and
  `visiblePitchRange` rounds its bounds to integers
  (`Math.floor`/`Math.ceil`) before returning, since pitch is discrete
  and `drawPianoRoll`'s per-semitone row loop needs integer-aligned
  bounds — the continuous tick axis has no equivalent need.
  `panPitch` is an absolute pitch (clamped to the full span), mirroring
  how `panTick` is an absolute tick clamped to `[0, durationTicks]` —
  worth calling out because ticks always start at 0 so that clamp floor
  is implicit, while pitch spans don't start at 0, so the floor is
  `fullSpan.lowestPitch` explicitly.
- `drawPianoRoll.ts`'s `buildViewport` gained an optional 5th parameter,
  `pitchWindow`, used in place of the computed lowest/highest-note ± 2
  bounds when given — confirmed before changing anything that every
  other consumer of `viewport.lowestPitch`/`highestPitch`
  (`drawPitchMarkers`, `drawPlayhead`, `hitTest.ts`,
  `coordinates.ts`'s `pitchToY`/`yToPitch`, pitch-marker dragging in
  `PianoRoll.tsx`) already treats the viewport as an arbitrary window
  and skips drawing/hit-testing anything outside it, the same way they
  already do for the tick axis — so none of those needed to change,
  only what gets passed into `buildViewport` did. Also added
  `computeFullPitchSpan` (the same ±2-padded computation, exported so
  `PianoRoll.tsx` and `buildViewport` resolve against the same span).
- `PianoRoll.tsx`: new `pitchViewportWindow` state, reset alongside
  `viewportWindow` on a genuinely new project. New `fullPitchSpan`/
  `pitchRange` memos mirroring the existing `tickRange` memo, feeding
  `buildViewport`'s new parameter. The review-mode Tab-stepping reveal
  effect now also calls `panPitchToReveal` for the selected note's
  pitch (the playback page-follow effect does _not_ — the playhead is
  a full-height vertical line with no pitch of its own, so it can
  never be vertically scrolled out of view). The wheel handler gained
  two branches ahead of the existing ones: `Ctrl/Cmd+Shift` zooms
  vertically anchored at the cursor Y (via `yToPitch`, which already
  handles the inverted pitch/y mapping correctly); `Shift` alone pans
  vertically. The vertical-pan delta is **negated** relative to the
  horizontal pattern — pitch increases upward on screen (lower y =
  higher pitch), the opposite of tick/x, so a positive scroll delta
  needs to decrease `panPitch` to reveal lower pitches, the intuitive
  "scroll down reveals what's below" direction. Also prefers
  `deltaY`, falling back to `deltaX`, for the same reason the existing
  horizontal-pan branch does: a plain mouse wheel held with `Shift` is
  commonly remapped by the OS into a horizontal-scroll event
  (`deltaX` populated, `deltaY` zeroed) before the handler ever sees
  it. "Reset zoom" now resets both windows; its visibility condition
  is "either axis is zoomed," and its label shows `H {x} · V {x}` only
  when both axes are actually zoomed, otherwise just the one relevant
  number.
- `App.tsx`: appended a clause to the existing keyboard-shortcut hint
  paragraph documenting the new wheel gestures (the only place
  shortcuts are already documented in this app).
- New `pitchViewportWindow.test.ts`, same test shape as
  `viewportWindow.test.ts` (clamp, visible-range shrink/clamp at both
  ends, zoom-anchor preservation, pan, reveal) — 15 tests.
- Verified with a throwaway Playwright script (faked Tauri IPC, real
  dev-server bundle): a synthetic 7-row, 68-semitone-span fixture,
  screenshotted before/after `Ctrl+Shift+wheel` zoom (rows visibly
  grew taller, anchored near the cursor), confirmed `Shift+wheel` pans
  without changing the zoom level or button label, confirmed "Reset
  zoom" restores the exact original screenshot pixel-for-pixel, and
  confirmed clicking a note against the now-much-taller zoomed-in rows
  still selects the correct pitch (proving hit-testing needed zero
  changes, as expected from reading the existing code first). Script
  and screenshots deleted after use, not committed.
- Verified: `pnpm test` (166/166, 15 new), `pnpm lint`,
  `pnpm format:check`, `pnpm build` all clean. No Rust changes — this
  is entirely frontend canvas/viewport logic.

### Global (windowed lookahead) assignment mode

User asked for a deep dive into whether more `SeparationStrategy`
presets existed beyond the four already shipped. Investigation
concluded the four presets are all reweightings of one algorithm
(greedy, note-at-a-time, irrevocable nearest-cost assignment) and that
the actually-missing thing in the literature is a different algorithm
family (global/DP optimization instead of greedy). Before building
anything, prototyped a brute-force oracle (temporary `#[cfg(test)]`
module in `voice_assignment.rs`, reusing the real `score_candidates`
cost function, deleted after use) that found the true minimum-cost
partition for small synthetic note sets and compared it against
greedy's actual output: greedy matched the optimum on all 4 existing
hand-written fixtures, but diverged on 84/300 (28%) of fuzzed cases
with a forced early ambiguous choice, mean gap 2.45, worst gap 45 —
concretely, an early channel-continuity pick can force a much worse
split several notes later that greedy can never revisit, where the
true optimum instead forms a clean low/high pitch-register grouping.
This confirmed the algorithm gap was real before committing to build
it.

User chose to expose this as a new `AssignmentMode` (Greedy | Global)
orthogonal to `SeparationStrategy`, rather than a 5th strategy variant
— discussed pros/cons first: a 5th variant needs zero new UI/command
surface but conflates weighting (data) with algorithm (search
strategy) and can't compose ("Global + RegisterPriority" would need
its own variant); a separate axis matches how the codebase already
separates `CostWeights` from the assignment loop and composes for
free, at the cost of a second command parameter and UI control.

- New `assign_voices_with_locks` in `voice_assignment.rs` dispatches
  on `AssignmentMode` to either the existing
  `assign_heuristic_voices_with_locks` (`Greedy`) or the new
  `assign_windowed_voices_with_locks` (`Global`).
- `assign_windowed_voices_with_locks`: buffers up to
  `LOOKAHEAD_WINDOW` (6) unlocked notes, then exhaustively searches
  every valid grouping of that window (branch-and-bound on total
  cost, top-`LOOKAHEAD_CANDIDATES_PER_NOTE` (3) cheapest compatible
  voices considered per note to bound branching independent of how
  many voices already exist in a long piece) before committing any of
  them. A locked note flushes whatever's pending first (locks can't
  be reordered around), then pins exactly as in `Greedy`.
  Confidence/reason reporting is computed in a separate pass against
  the full compatible-voice set, not the pruned search shortlist, so
  reporting accuracy doesn't depend on search-time pruning.
- **Bug found and fixed during implementation, before it ever reached
  a test file**: the first version scored opening a new voice at a
  flat 0 (matching greedy's convention of never scoring
  `NewVoiceNoFit` at all) with no cap other than the user's optional
  `max_voice_count`. In an unconstrained global-cost minimization, 0
  always beats any positive-cost reuse, so the search degenerated into
  opening a near-maximal number of voices instead of finding a sane
  grouping — caught immediately by the adversarial regression test
  (`finds_the_pitch_register_split_that_greedy_misses`) failing with
  the seed notes split across 3 voices instead of 2. Fixed by adding
  `structural_new_voices_needed`, the classic "minimum meeting rooms"
  greedy scheduling algorithm generalized to treat each already-open
  voice as a room that only frees up at its `last_end_tick` rather
  than at time zero — a hard lower bound on new voices needed, so
  capping the search there restores the real reuse-vs-new trade-off
  greedy gets for free from its compatibility constraint.
- Rust tests (`windowed_tests` in `voice_assignment.rs`): greedy-parity
  on trivial reuse/overlap cases, determinism, lock pinning +
  pending-buffer flush around a lock, voice-cap forcing, first-voice-
  allowed-at-cap-zero, and the adversarial regression test above
  (asserts greedy actually gets the fixture wrong first, so the test
  documents the contrast rather than assuming it).
- Command boundary: `reassign_voices` gained a `mode: AssignmentMode`
  parameter; `AssignmentMode` added to `model.rs` next to
  `SeparationStrategy`, same `SCREAMING_SNAKE_CASE` serde convention.
- Frontend: `commands.ts` gained the `AssignmentMode` type and a
  `mode` parameter on `reassignVoices`; `App.tsx` gained an
  `assignmentMode` state (default `"GREEDY"`) and a "Search" selector
  next to the existing "Strategy" selector in the re-run-separation
  panel, styled by extending the existing
  `.separation-strategy-label`/`-select` CSS rules to also match the
  new `.assignment-mode-label`/`-select` classes rather than
  duplicating identical rules.
- Verified with a scratch `#[ignore]`d timing test (same pattern as
  the greedy heuristic's own Phase 6 performance validation; run once
  via `cargo test --release ... -- --ignored --nocapture`, then
  deleted): 16-wide advancing chords forcing 16 concurrent voices took
  7.1ms at 2,000 notes and 27.7ms at 8,000 notes (roughly linear, no
  blowup) — comfortably interactive for an on-demand "Re-run
  separation" click at any realistic chiptune scale.
- Verified: `cargo fmt --check`, `cargo check`, `cargo test` (51/51),
  `cargo clippy --all-targets --all-features -- -D warnings` all
  clean. `pnpm test` (166/166), `pnpm lint`, `pnpm format:check`,
  `pnpm build` all clean.

### Real-fixture validation of Global mode, and a second real fixture

Ran the same `Greedy` vs. `Global` comparison from the design-time
brute-force oracle against real content instead of only synthetic
fixtures, using the separate-tracks Boss Battle 6 file the user
sourced (CC0, opengameart.org) and its combined (single-track,
single-channel) companion. Built a permanent cost-comparison helper
(`total_cost_of_committed_assignment` in `voice_assignment.rs`,
replaying a committed note->voice_id mapping through the real
`score_candidates` formula) rather than relying on
`assignment_confidence`, since confidence measures how locally
decisive a pick was, not whether the overall grouping is cheaper --
and on this file the two metrics moved in opposite directions (see
below).

- Combined fixture (no channel signal): `Global` beat `Greedy` on
  total cost on every strategy where channel information could
  matter (11% lower on `Balanced`, 9% on `RegisterPriority`).
  `ChannelPriority`/`StrictChannel` produced identical results under
  both modes -- expected, since with everything on one channel every
  candidate gets the same channel bonus, so there's no real choice
  for either algorithm to make differently.
- Separate-tracks fixture (13 real channels, added to `fixtures/` as
  `boss-battle-6-separate-tracks.mid` since it's beneficial,
  complementary coverage): `Global` beat `Greedy` on cost across all
  four strategies here too, by an even larger margin (31% lower on
  `Balanced`). This file is what validates `ChannelPriority`/
  `StrictChannel` actually work as designed: mean confidence jumped to
  0.91-0.975 (vs. 0.66-0.75 for the pitch-only strategies), confirming
  channel-based separation earns its keep when the channel signal it
  depends on is real.
- Counterintuitive-but-correct finding: on `Balanced`/`RegisterPriority`,
  `Global`'s lower cost came with more low-confidence notes, not
  fewer -- it sometimes takes a locally non-obvious note to buy a
  better global grouping, and that honestly shows up as lower local
  confidence. On `ChannelPriority`/`StrictChannel`, `Global` improved
  cost and confidence slightly, since a strong reliable signal means
  smarter global choices tend to agree with local intuition rather
  than override it.
- Added two permanent regression tests
  (`global_mode_matches_or_beats_greedy_cost_on_a_real_combined_fixture`/
  `..._separate_tracks_fixture`, sharing one helper) asserting `Global`'s
  cost is never worse than `Greedy`'s on either real fixture, across
  all four strategies -- so a future change that regresses `Global`
  below `Greedy` on real content fails loudly, not just on synthetic
  cases. All exploratory comparison code (the diagnostic that produced
  the numbers above) was scratch, run via a temporary `#[ignore]`d
  test, then deleted once the numbers were captured.
- `fixtures/README.md` documents both files' shared provenance
  (["Boss Battle #6 (8 bit)"](https://opengameart.org/content/boss-battle-6-8-bit)
  by cynicmusic, CC0) and what each one is for.

### Sliding window (fixed the chunk-boundary blind spot in Global mode)

`Global` originally committed fixed, non-overlapping `LOOKAHEAD_WINDOW`-note
chunks: solve chunk, commit everything in it, start a fresh empty
chunk. This meant a note's amount of foresight depended entirely on
where it fell relative to a chunk boundary -- a note last in its
chunk got zero benefit from the notes in the next chunk, the same
blind spot as plain greedy. Verified this concretely rather than just
reasoning about it: `git stash`ed the sliding-window change, added a
test that shifts the existing adversarial fixture (prepending 3
inert filler notes so the pivot note lands exactly on the old
chunk-boundary index), ran it against the stashed (chunked) code --
failed, confirming the blind spot was real -- then `git stash pop`ped
back and confirmed the same test passes against the sliding
implementation.

- `pending` changed from `Vec<usize>` to `VecDeque<usize>`. Once it
  reaches `LOOKAHEAD_WINDOW`, every subsequent note first triggers
  `slide_pending_window` (re-solve the full current window, commit
  only the oldest pending note, pop it) before the new note joins
  the queue -- so every unlocked note is finalized only after the
  search has already seen the `LOOKAHEAD_WINDOW - 1` notes that come
  after it, regardless of position in the piece. `flush_pending_window`
  (commit everything currently pending) is unchanged in spirit, still
  used for the trailing notes at end of input and immediately before
  a locked note; both now share a `solve_pending_window` helper
  extracted from the old `flush_pending_window` body so the "search"
  and "how much to commit" concerns aren't duplicated.
- New test `finds_the_pitch_register_split_even_when_the_pivot_lands_on_the_old_chunk_boundary`,
  kept permanently (unlike the throwaway stash-based verification
  above) since it's the concrete proof this class of bug is fixed and
  stays fixed.
- Cost: re-solving every note instead of every `LOOKAHEAD_WINDOW`th
  note is roughly `LOOKAHEAD_WINDOW`x more search calls. Re-measured
  the same worst-case synthetic project (16-wide advancing chords,
  16 concurrent voices) via the same scratch-`#[ignore]`d-timing-test
  pattern: 38.7ms at 2,000 notes (was 7.1ms), 153.6ms at 8,000 notes
  (was 27.7ms) -- roughly 5-6x slower as expected, still comfortably
  interactive for an on-demand "Re-run separation" click, and still
  scales linearly with no blowup.
- Verified: `cargo fmt --check`, `cargo test` (54/54),
  `cargo clippy --all-targets --all-features -- -D warnings` all
  clean.

### Contig-mapping assignment mode (`AssignmentMode::Contig`)

User asked whether any other separation algorithm families were worth
adding beyond greedy and the windowed global search, and picked
contig mapping (Chew & Wu 2004) from the options presented — the only
candidate that's a genuinely different algorithm family (segment-and-
connect) rather than an upgrade to note-at-a-time scoring.

- `src-tauri/src/midi/voice_assignment.rs`: new
  `assign_contig_voices_with_locks`, dispatched from
  `assign_voices_with_locks` for the new `AssignmentMode::Contig`
  (`model.rs`). The piece is segmented into contigs — maximal spans of
  constant polyphony (`build_contigs`); silence ends a contig. Within a
  contig, voice-leading is treated as unambiguous: each sounding note
  seeds a pitch-ordered fragment, and at a tick where equally many notes
  end and start (constant count), departures are matched to arrivals via
  `match_succession` — same-channel replacements first (a same-tick
  replacement on one channel is the same instrument continuing; a signal
  the channel-less original paper never had), remainder by pitch order.
  At contig boundaries, fresh fragments are matched against **all**
  resting chains (not just the previous contig's) via a non-crossing
  minimum-cost alignment DP (`align_fragments_to_chains`), scored by the
  existing `score_candidates`/`CostWeights`, so all four
  `SeparationStrategy` presets apply. Opening a new chain costs
  `NEW_CHAIN_PENALTY` (100k) in the DP, so it only happens when there are
  structurally more fragments than compatible chains — the same
  convention greedy gets from its candidate filter. Matching against all
  resting chains means a voice that rests through a solo passage keeps
  its identity on re-entry (covered by a dedicated test).
- Cap: unmatched fragments beyond `max_voice_count` are forced into the
  cheapest existing chain; the replay pass flags their overlapping notes
  `VoiceCapReached`/0.0. Lowest-pitched fragments keep new-chain slots
  when the cap can't cover all of them (simple + deterministic; forced
  ones are flagged regardless). Locked notes are exempt, as everywhere.
- Locks: a chain containing locked notes claims that locked voice id
  (majority, first-encountered on ties), so a correction pulls its whole
  fragment chain into the corrected voice; every locked note is
  additionally pinned to its exact locked id afterward as a hard
  per-note guarantee (`UserLocked`/1.0). Fresh ids never collide with
  locked ids (same `allocate_new_voice_id` reservation as greedy).
- Confidence/reason reporting: new `replay_assignment_reporting` replays
  the committed ids in time order through the same rules
  `commit_window_result` reports with (first note of a voice =
  `NewVoiceNoFit`, overlap = `VoiceCapReached`, otherwise cost-gap
  confidence + `ChannelContinuity`/`ClosestPitch`).
- Zero-length notes (parser keeps them with a warning) are swept as
  lasting one tick (`effective_sweep_end`) so they can't silently fall
  out of every contig; scoring still uses real end ticks.
- Frontend: `commands.ts`'s `AssignmentMode` union gained `"CONTIG"`;
  `App.tsx`'s Search selector gained "Contig (structure)". No other
  wiring needed — the mode parameter already threads through
  `reassign_voices`.
- **Measured honestly against both real fixtures** (scratch `#[ignore]`
  test, deleted after use, same pattern as the Global-mode validation):
  - Combined fixture (single channel — the weak-channel-signal case this
    mode targets): Contig beats Greedy on total cost under Balanced
    (1645 vs 1867), ChannelPriority, and StrictChannel (and is the
    cheapest of all three modes on those last two), with a tighter max
    voice span than Greedy (48 vs 52 semitones). Global still wins
    Balanced cost (1279) and span (36). Runtime ~2.3ms vs Global's
    ~22ms at 1231 notes — both interactive.
  - Separate-tracks fixture (13 real channels): **Contig is clearly
    worse than both other modes across every strategy** (e.g.
    ChannelPriority mean confidence 0.73 vs Greedy's 0.91). Root cause,
    confirmed by measuring before/after the channel-aware succession
    change (which only improved it marginally): the non-crossing
    boundary alignment is ordered by pitch, so a channel-correct
    matching that crosses in pitch space is structurally inexpressible,
    no matter the strategy weights. This is inherent to the contig
    family's "voices don't cross" premise. Practical guidance: use
    Contig on files without a reliable channel signal; on clean
    multi-channel files StrictChannel/Greedy is already near-perfect
    (0.975 mean confidence) and Contig is the wrong tool.
- 13 new tests in `contig_tests` (greedy-parity basics, determinism,
  pitch-order succession, same-channel-over-pitch succession, the
  adversarial register-split fixture that greedy provably misses —
  structurally unambiguous under contigs, no lookahead needed —
  solo-passage chain re-entry, lock pinning + fragment pull, cap
  forcing/first-voice/locked-exempt, zero-length notes, and a
  both-fixtures × all-strategies smoke test asserting full coverage,
  summary consistency, and determinism).
- Verified: `cargo test` (67/67), `cargo clippy --all-targets
--all-features -- -D warnings`, `cargo fmt --check`, `pnpm test`
  (176/176), `pnpm lint`, `pnpm format:check`, `pnpm build` all clean.
- Not yet verified: manual `pnpm tauri dev` pass selecting "Contig
  (structure)" in the Search selector and re-running separation against
  a real file (the Rust logic and frontend wiring are covered by tests,
  but no live end-to-end click-through was run this session).

### Beam search in Global mode (window 6 → 16)

Follow-up the contig-mode measurements pointed at: Global's cost lead
suggested lookahead depth was the binding constraint, and the exhaustive
window search's `candidates ^ window` blowup capped the affordable
window at 6.

- `solve_pending_window` in `voice_assignment.rs` no longer runs the
  recursive exhaustive `search_window` (deleted); it now runs a
  width-bounded beam: at each window depth, every surviving partial
  assignment expands via the extracted `branch_targets` helper (same
  branch rules as before — top `LOOKAHEAD_CANDIDATES_PER_NOTE`
  compatible voices, "open new" when the structural budget allows,
  forced-cheapest at the cap), and only the `BEAM_WIDTH` cheapest
  expansions survive. Expansion happens **before** cloning any state
  (`(projected cost, parent, target)` tuples, `select_nth_unstable` +
  sort, then materialize only survivors) — cloning a parent's voice list
  is the expensive part, so pruned branches never pay for it.
  Determinism: ties break on (parent position, target index).
- `branch_targets` scores the whole voice list in **one**
  `score_candidates` call and picks the top 3 by capped insertion
  (`partition_point`), not a sort — this is the hottest loop in Global
  mode and per-call allocation dominated its runtime when scored
  voice-by-voice.
- Final constants: `LOOKAHEAD_WINDOW = 16`, `BEAM_WIDTH = 32`, chosen
  from a measured sweep (release, both real fixtures, scratch
  `#[ignore]` test deleted after use). Quality vs the old exhaustive
  window-6 (total committed cost, Balanced): combined fixture 1279 →
  955 (−25%), separate-tracks 1576 → 368 (−77%), with max voice spans
  down (55 → 43 on separate/Balanced). Beam 64 bought a further ~17%
  on separate-tracks at 2-3× the time (5s), window 12 lost real
  quality — 16/32 is the knee. Runtime: ~0.34s (1231 notes) / 1.4-2.5s
  (3770 notes, 12 voices) in release; the old search was ~0.1s but far
  worse. Also tried and **rejected**: a beam cost-margin prune (drop
  states > margin worse than the depth's best) — margin 64 pruned
  nothing (the beam is saturated with near-ties), margin 16 wrecked
  quality (spans 65-69 st) without real speedup; don't re-attempt it
  blind.
- **`[profile.test] opt-level = 1` added to `src-tauri/Cargo.toml`**:
  the real-fixture regression tests run the beam over thousands of
  notes; at opt-level 0 the suite took 82s (vs 1.3s before the beam).
  With light optimization it's ~10-12s. First `cargo test` after this
  change rebuilds all deps under the new profile once (~4 min);
  incremental runs are normal.

### Voice-crossing penalty (`crossing_weight` in `CostWeights`)

The other follow-up chosen from the algorithm survey: Temperley/Huron's
"avoid voice crossing" principle, previously absent — nothing stopped a
voice from taking a note that leapt over another voice still sounding
between the two pitches.

- `score_candidates` adds `crossing_count * weights.crossing_weight`,
  where `crossing_count` = number of _other_ voices still sounding at
  the note's start (`last_end_tick > note.start_tick`) whose last pitch
  lies strictly between the candidate's last pitch and the note's
  pitch. Computed via a sorted sounding-pitch list + two
  `partition_point`s per candidate (the hot beam loop stays cheap); a
  candidate's own pitch is never counted (always an endpoint of the
  strict range). **Bug caught by the fixture tests during
  implementation**: `to - from` underflows when the note repeats the
  candidate's last pitch (empty strict range ⇒ `to < from`) —
  `saturating_sub`, and a regression-tested reminder that u8/usize
  subtraction needs care.
- Weights: Balanced/ChannelPriority 2.0, RegisterPriority 3.0 (pitch
  structure is all it has), StrictChannel 0.0 (distinct instruments
  cross registers constantly; channel identity is the preset's whole
  point). No existing test expectation flipped at these values.
- **Consequence for scoring call sites**: the crossing term needs the
  full voice slice as context, so every former
  `score_candidates(std::slice::from_ref(voice), ...)` call was
  converted to full-slice scoring + index into the result (indices
  align when `require_compatible` is false): `commit_window_result`'s
  decided-cost, `replay_assignment_reporting`, contig's
  `align_fragments_to_chains` (scores each fragment against all chains
  in one call now) and its forced-at-cap path, and the test harness
  `total_cost_of_committed_assignment` (HashMap → index-aligned Vec).
  A `from_ref` call against `score_candidates` now silently computes a
  cost with no crossing context — the doc comment on the function warns
  about this.
- New test `crossing_penalty_avoids_leaping_over_a_sounding_voice`:
  two resting candidates where raw pitch distance picks the voice that
  would leap over a third, still-sounding voice; the term flips it.
- Measured on both fixtures (same scratch pattern, deleted after use;
  crossings metric = committed notes that leapt over a sounding voice,
  weight-independent so comparable before/after): Global's crossings
  drop 30-45% everywhere (combined Balanced 68 → 39; separate
  ChannelPriority 303 → 242) and combined-fixture max spans tighten to
  40 st under all three non-strict strategies (were 47-51). Greedy's
  crossings barely move (119 → 115) — expected, greedy can only avoid
  a crossing when an alternative compatible voice exists at pick time.
  Weights deliberately left at these first values rather than tuned
  further against one fixture pair.
- Verified (both changes together): `cargo test` (68/68, 1 new),
  `cargo clippy --all-targets --all-features -- -D warnings`,
  `cargo fmt --check`, `pnpm test` (176/176), `pnpm lint`,
  `pnpm format:check`, `pnpm build` all clean. No frontend changes —
  both are internal to the Rust cost model/search, no new command
  parameters or UI.
- Not yet verified: manual `pnpm tauri dev` pass re-running separation
  in Global mode against a real file to eyeball the (measurably
  better) groupings.

### Smart import: percussion isolation, track-name labels, strategy suggestion

User chose this slice ("making the parsing more intelligent" and "big UX
wins" turned out to be the same work) over pure-UX candidates. Three
pieces, all landing at import time:

- **Percussion isolation.** `assign_voices_with_locks`
  (`voice_assignment.rs`) now runs a pre-pass before dispatching to any
  mode: channel-10 (0-indexed `PERCUSSION_CHANNEL = 9`) notes go straight
  to a dedicated `PERCUSSION_VOICE_ID = "percussion"` voice (label
  "Percussion", new `AssignmentReason::Percussion`, confidence 1.0), and
  the pitched remainder runs through Greedy/Global/Contig as before —
  GM drum "pitches" are drum identities (36 = kick), and the cost model
  was interleaving kicks into basslines wherever the numbers landed
  close (regression-tested:
  `a_drum_note_no_longer_attracts_the_bass_line`). Locks beat the
  routing (a percussion note locked elsewhere follows its lock); the
  percussion voice sits outside `max_voice_count`; a pitched note locked
  _into_ the percussion voice merges into one listing.
  `assign_heuristic_voices` (the parser's import path) now goes through
  this same choke point, so import and re-run behave identically. On the
  real separate-tracks fixture this routes 840 drum notes out of the
  pitch model.
- **Track names → voice labels.** The parser now captures each track's
  first `TrackName` and labels every voice with its majority source
  track's name (ties to the lowest track index; duplicates get " 2"/" 3"
  suffixes; unnamed tracks keep "Voice N" defaults). **Skipped when only
  one track bears notes** (unless it's an app-exported file) — caught by
  running against the real combined fixture, where the lone track's name
  ("Boss Battle 6 V1") is the _song's_ name and stamping it on all 8
  voices was noise. On the separate-tracks fixture this yields "Bass",
  "Lead Guitar", "Guitar Left/Right", "Percussion".
  **Export side:** `exporter.rs` now writes each voice's real label as
  its `TrackName` (so exports open with meaningful names in any DAW and
  labels round-trip back on reimport — new test
  `exports_voice_labels_as_track_names_and_reimports_them`). That name
  used to be the fixed sentinel the parser detected app-exported files
  by; detection moved to a `Text` meta marker
  (`EXPORTED_VOICE_TRACK_MARKER` in `mod.rs`), with the legacy
  `EXPORTED_VOICE_TRACK_NAME` sentinel still recognized so pre-change
  exports keep round-tripping (regression-tested). `build_export_smf`'s
  `Smf` lifetime is now tied to the project (labels are borrowed), so
  test call sites bind the project before calling.
  **Frontend:** new `seedVoiceLabelsFromImport` (`voiceManagement.ts`)
  seeds the editable label map from import with only non-generic labels
  ("Voice N" defaults stay out so index-based renumbering keeps
  working); `buildVoiceList` falls back to "Percussion" for the
  percussion voice id.
- **Strategy suggestion.** New `suggest_strategy` in `parser.rs`
  analyzes the melodic (non-percussion) channel distribution:
  ≥2 significant channels (≥5% of melodic notes each) with no channel
  above 60% → `StrictChannel`; a dominant channel or a single channel →
  `RegisterPriority` (with reason text saying why); notes-free files →
  `Balanced`. If drums were routed, the reason says so. Ships as a new
  required `MidiProjectDto.strategy_suggestion: StrategySuggestionDto
{ strategy, reason }` (fixture literals updated on both sides, Rust and
  TS). The frontend preselects the Strategy dropdown from it on import
  (`applyImportedProject`) and shows
  `formatStrategySuggestion(...)` as a second full-width row in the
  separation-summary banner (`.strategy-suggestion` in `global.css`).
  Validated against both real fixtures: combined → RegisterPriority
  (the strategy the register-drift work established as right for it),
  separate-tracks → StrictChannel (the strategy that measured 0.975
  mean confidence).
- Housekeeping: `SeparationStrategy` (TS) moved from `commands.ts` to
  `midiProject.ts` (it's now a domain concept appearing in the imported
  project), re-exported from `commands.ts` so callers keep one import
  site; the TS `AssignmentReason` union also gained the previously
  drifted `USER_LOCKED`/`VOICE_CAP_REACHED` alongside the new
  `PERCUSSION`.
- Verified: `cargo test` (83/83 — 5 new percussion, 8 new parser, 1 new
  exporter round-trip, plus the single-track-label refinement test),
  `cargo clippy --all-targets --all-features -- -D warnings`,
  `cargo fmt --check`, `pnpm test` (180/180 — new
  `seedVoiceLabelsFromImport`, percussion-fallback, and
  `formatStrategySuggestion` tests), `pnpm lint`, `pnpm format:check`,
  `pnpm build` all clean. Real-fixture behavior confirmed via a scratch
  `#[ignore]` print test (deleted after use, findings above).
- Not yet verified: manual `pnpm tauri dev` pass — import a
  multi-channel file and eyeball the seeded labels, the preselected
  strategy + banner hint, and the Percussion voice in the legend.

## Architecture Invariants

- Ticks are the canonical timing coordinate. Do not convert core MIDI state to
  seconds unless the task is display or playback specific.
- Rust parses borrowed `midly` data into owned DTOs before crossing into Tauri.
- Voice assignment must be deterministic. If note ordering changes, add tests
  that prove the resulting voice IDs are stable.
- Manual voice corrections should affect the derived project used for display
  and export, not mutate the original imported project.
- Export should write a format-1 SMF with a conductor track and one note track
  per voice.
- If export persistence is touched, verify that exporting and reimporting keeps
  corrected voice assignments.

## Verification Commands

Use the narrowest useful checks while developing, then broaden before handing
off.

```powershell
pnpm test
pnpm build
pnpm lint
pnpm format:check
pnpm rust:check
pnpm rust:test
pnpm rust:clippy
```

Equivalent direct Rust commands are acceptable when working only in
`src-tauri`:

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
```

For desktop startup validation:

```powershell
pnpm tauri dev
```

Record which checks passed in the handoff or final response. If a check cannot
run, state why.

## Handoff Notes

When leaving work for another agent, include:

- The user-facing goal.
- Files changed.
- Commands run and results.
- Any manual verification still needed.
- Any known limitation or deliberate tradeoff.

Keep handoffs factual. Avoid speculative next steps unless they are directly
useful for continuing the current task.
