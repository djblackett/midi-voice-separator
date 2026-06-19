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
  lifecycle. Exports `InteractionMode = "select" | "paint"`.
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
- `src/domain/midi/voiceManagement.ts`: also holds `mergeVoiceOrder`, used
  after a "re-run separation" to fold any brand-new voice ids the backend
  allocated into the frontend's `voiceOrder`.
- `src/app/editorHistory.ts`: pure full-snapshot undo/redo stack
  (`createEditorHistory`, `pushHistory`, `undoHistory`, `redoHistory`) over
  `{ voiceOverrides, voiceOrder, voiceLabels }`. Kept separate from `App.tsx`
  so the stack-manipulation logic is unit-testable without React.

## Active Plan

The original 7-phase implementation plan for the heuristic voice-separation
engine and its correction UX is complete (all 7 phases done — see Progress
Log below). A follow-on roadmap plan now lives at the same path,
`C:\Users\davej\.claude\plans\sequential-watching-sprout.md` (outside this
repo): Phase 1 closes the testing gap (in progress — see Progress Log),
Phase 2 is a README catch-up, Phase 3 is the two items the original plan
deferred (`max_voice_count` soft cap, undoable re-run), Phase 4 is piano
roll pan/zoom, Phase 5 is playback (scoped as its own future plan), Phase 6
is performance validation on real dense files.

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
