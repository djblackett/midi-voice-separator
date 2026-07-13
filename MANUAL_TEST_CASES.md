# Manual test cases

A checklist of every currently implemented use case, for manual `pnpm tauri dev`
verification passes. Grouped by feature area in the order you'd naturally hit
them with a real MIDI file loaded. Each line is a "do this, expect that."

## Import

- Click **Import MIDI**, pick a `.mid`/`.midi` file → file details (format,
  suggested voice count, tempo changes, time signatures, recoverable warnings)
  and the piano roll populate.
- Click **Import MIDI** and cancel the dialog → nothing changes, no error.
- Import a file with a malformed/unsupported event → a "Recoverable import
  warnings" section lists each warning's code, track/tick location, and
  message; the file still loads.
- Import a second file after one is already loaded → selection, voice
  overrides, undo history, pitch markers, and pan/zoom all reset for the new
  project.

## Piano roll viewing

- Confirm the confidence summary banner reads "N% mean assignment confidence
  — M notes flagged for review" (or "no notes flagged for review" when M=0).
- Low-confidence notes render with a dashed outline; others render solid.
- Each voice renders in a consistent, distinct color.

## Selection

- Click a single note → "Selected note" panel shows pitch, voice, channel,
  ticks.
- Shift-click a second note → both selected, panel switches to the
  multi-select summary (count, voice count, pitch range).
- Shift-click an already-selected note → it's removed from the selection.
- Drag a marquee over several notes → all notes inside the rectangle are
  selected (try a drag starting near the very top of the roll, just below the
  minimap — should work normally, not be swallowed by the minimap).
- Shift-drag a marquee → adds to the existing selection instead of replacing
  it.
- Click empty space (no marquee movement) → selection clears.
- Press `Esc` → selection clears.
- Drag across the time ruler above the piano roll → every note sounding in
  that tick range becomes selected, including notes that straddle the range
  boundaries.
- Click the time ruler → playback seeks to that tick without changing the
  selection.

## Bulk reassignment (number keys)

- Select one or more notes, press `1`-`9` → notes reassign to the
  corresponding voice (by position in the voice list); piano roll and voice
  note counts update immediately.
- Press a number with nothing selected → no-op.
- Press a number beyond the current voice count (e.g. `9` with 3 voices) →
  no-op.
- Reassigning while focused in a text input (e.g. a voice rename field) →
  ignored, doesn't fire the shortcut.

## Voice management

- Click **+ New voice** → a new voice appears in the legend; if notes were
  selected, they're reassigned into it.
- Edit a voice's name field → label updates live everywhere it's shown
  (legend, pitch-range rule list, paint-mode hint).
- Click **Solo** on a voice → only that voice's notes render at full
  opacity (others dim) and only that voice is audible during playback.
  Click again → solo clears.
- Click ▲/▼ next to a voice → it reorders in the legend (buttons disabled at
  the top/bottom of the list).
- Use a voice's "Merge into..." dropdown to pick another voice → all of the
  source voice's notes move to the target voice, and the source voice
  disappears from the legend. If it was active/soloed, that state clears.
- Click a voice's colored swatch → selects every note currently in that
  voice.

## Review mode (flagged notes)

- With flagged notes present, click **Review flagged notes (N)** → jumps to
  the first flagged note and selects it.
- Press `Tab` → advances to the next flagged note (selecting it, panning the
  view to reveal it if off-screen).
- Press `Shift+Tab` → goes to the previous flagged note.
- Stepping past the last/first flagged note wraps or stops sensibly (check
  it doesn't throw or get stuck).

## Fullscreen workspace

- Click **Fullscreen workspace** in the piano-roll toolbar -> the editor fills
  the viewport, and the piano roll gets the remaining height below the toolbar.
- In fullscreen, turn on **Paint mode** -> Pencil/Brush/Lasso/Wand controls,
  brush/reach options, active voice chip, playback controls, and view toggles
  remain visible above the roll.
- Click **Exit fullscreen** -> the editor returns to the normal page layout.

## Voice-lane editing parity (Feature 6 acceptance)

- Switch from **Piano roll** to **Voice lanes** → the canvas exposes the accessible name "Voice
  lane note visualization," one row appears per voice, and switching back restores "Piano roll
  note visualization" without changing selection or horizontal position.
- Try one sparse file and one dense file → sparse rows use the available height; dense rows keep a
  readable minimum height and expose **Voice lane vertical scroll**. Wheel/trackpad scrolling and
  the range control's arrows, `Home`, and `End` can reach the final lane without producing a blank
  canvas. Selecting an offscreen voice or note reveals its row without changing horizontal zoom.
- In lanes, click, Shift-click, marquee, and Shift-marquee notes → selection membership matches the
  same gestures in the piano view. Double-click chord selection and right-click phrase/line/Assign
  actions target the expected notes.
- Use `1`-`9`, a context Assign action, and Undo/Redo in lanes → each correction takes exactly one
  undo step. `P`/`B`/`L`/`W` and the toolbar enter the requested paint tool without leaving lanes;
  switching Piano ↔ Voice lanes while painting keeps the tool active.
- Drag a Brush stroke across notes in adjacent source lanes → touched notes preview with the target
  voice color but stay in their source rows during the stroke, then move atomically on release.
  Crossing a lane boundary should neither skip a note nor repaint an untouched neighboring row.
- Draw a Lasso near the clipped top or bottom edge of a partially visible row → only enclosed or
  intersected visible notes preview and commit; backing the loop away removes them from preview,
  and the gesture does not latch after release or cancellation.
- Turn on Range markers in Piano → **Voice lanes** is disabled with "Exit Range markers before
  switching to Voice lanes." Exit Range and switch to lanes → **Range markers** is disabled with
  "Switch to Piano roll before enabling Range markers." Neither control silently changes mode or
  view.
- Compare both views with a selected note, Solo, confidence heat, changed-note filtering, an
  overlap conflict, playback, and an in-progress paint stroke → selection, dimming, heat color,
  changed edge, conflict cue, playhead, ruler/minimap alignment, and source-row preview remain
  legible and consistent.
- Enter fullscreen while lanes are visible → the lane canvas fills the remaining workspace and the
  view, playback, paint, heatmap, and lane-scroll controls remain reachable. Exit fullscreen and
  confirm the viewport is still valid.
- In split A/B lanes, edit side B and Undo once → only B changes and only B history moves; side A is
  unchanged. Verify independent lane scrolling first, then enable linking and reveal a matched
  voice. Revealing an unmatched voice leaves the other pane independent and shows the fallback.
- With Audition on, click and paint notes in lanes and listen for the expected voice timbre. During
  transport playback, confirm gesture audition is suppressed and the playhead remains horizontally
  aligned after zooming and panning.

## Paint mode

- Click **Paint mode: off** to turn it on → button shows "Paint mode: on";
  a Pencil/Brush/Lasso/Wand tool switcher, a size/reach slider for the
  active tool, and an active-voice chip appear; the hint says to pick a
  voice if none is active.
- Click a voice swatch while in paint mode → hint names the target voice
  and the voice chip shows its color and label.
- The native cursor disappears over the roll and is replaced by a drawn
  cursor: a voice-colored ring (Brush), a crosshair (Pencil), or a small
  loop-with-tail (Lasso). With no active voice the ring is gray and dashed.
- **Brush** (default): click or drag → every note the round brush passes
  over repaints into the active voice, with live color preview. A fast
  swipe across a run of notes catches all of them (no gaps between pointer
  samples).
- Hold `Alt` while brushing → notes under the brush are removed from the
  in-progress stroke instead of added.
- Brush size: the toolbar slider, `[` / `]` keys, and `Alt`+scroll over the
  roll all resize it; a "N px" bubble flashes near the cursor while
  resizing, and the toolbar readout stays in sync.
- **Pencil**: exactly the note under the cursor repaints — nothing nearby.
- **Wand**: click a note → its whole connected melodic phrase (time-adjacent
  notes within the Reach pitch jump) repaints in one click; the Reach
  slider (1-12 semitones) controls how far the fill spreads. Dragging
  floods each newly touched note's phrase additively.
- **Lasso**: drag a freehand loop → the path draws with animated dashes
  and a translucent voice-tinted fill; enclosed notes preview live and are
  committed on release. Backing the loop off a note un-previews it.
- Each stroke (any tool) is one undo step.
- `P` / `B` / `L` / `W` jump straight to that tool (entering paint mode
  if needed); pressing the active tool's key again exits to select mode;
  `Escape` cancels an in-progress stroke and leaves paint mode.
- Toggle paint mode off → returns to normal select/marquee behavior and
  the native cursor.
- Pressing `1`-`9` while in paint mode sets the active voice instead of
  reassigning a selection.

## Audition

- With **Audition: on** (the default), clicking a note plays a short quiet
  blip at its pitch, using the same waveform its voice uses in playback
  (or the piano sample when the Piano sound is selected and loaded).
- Painting (pencil/brush/wand) blips notes as they join the stroke —
  a fast brush sweep sounds like a run, not a machine gun (throttled).
- Double-clicking a chord plays the chord's notes together (capped).
- Audition is silent while transport playback is running.
- Toggle **Audition: off** → gestures are silent again.

## Confidence heatmap

- Click **Confidence heat: off** (or press `H`) → notes recolor by
  assignment confidence — red (uncertain) through amber to green
  (certain/locked) — and an "uncertain → certain" gradient legend appears
  in the toolbar.
- Low-confidence dashed outlines and selection strokes still render on
  top of the heat colors.
- Painting while heat view is on previews the stroke in the target
  voice's color (live stroke feedback wins over heat).
- Toggle off (button or `H`) → voice colors return.

## Smart selection

- Double-click a note (select mode) → its whole vertical chord (notes
  sharing its start/end within a 32nd-note tolerance) becomes the
  selection.
- Right-click a note → a context menu appears with **Select chord**,
  **Select phrase**, **Keep top line only** / **Keep bottom line only**
  (only when 2+ notes are selected), and an **Assign … to** row of
  colored voice swatches.
- Right-click a _selected_ note and assign → the whole selection moves;
  right-click an unselected note and assign → just that note moves. Both
  are single undo steps.
- **Keep top line only** on a selection spanning chords → only the
  highest sounding note at each moment survives (the melodic skyline);
  bottom line mirrors it for the bass.
- The context menu closes on Escape, on clicking elsewhere, and after
  any action; right-clicking empty canvas with nothing selected shows no
  menu (and never the browser's own menu).

## Pitch-range mode

- Click **Range markers: off** to turn it on → hint appears: "Drag marker
  handles in the left piano-roll gutter, then apply the pitch ranges."
- Drag a marker handle in the left gutter up/down → its pitch value (shown
  in the "Pitch ranges" panel's number input) updates live, and the
  corresponding rule descriptions ("Pitch > N", "N < pitch <= M", "Pitch <=
  N") update too.
- Edit a marker's pitch directly via its number input → marker moves to
  match.
- Click **Apply ranges** → every note matching a rule's pitch band gets
  reassigned to that rule's voice; matching notes become the new selection.
- Hand-correct a note (number-key reassign, paint, or merge) that a range
  rule would also match, then click **Apply ranges** again → that note's
  hand correction is preserved, not overwritten. Other untouched matching
  notes still get (re-)assigned normally.
- With only one voice (so fewer than 3 range rules exist), confirm the rule
  list still reflects however many rules apply, or "Create at least one
  voice before applying ranges" shows if there are none.

## Smart fixes

- When the file has a cluster of nearby low-confidence notes, the **Smart
  fixes** panel suggests reviewing that cluster; click **Select notes** → the
  cluster becomes the current selection for inspection or reassignment.
- When a one-note non-percussion voice can merge into a nearby voice without
  creating an overlap, click **Merge voice** → the source voice disappears and
  the moved note is locked into the target voice.
- When adjacent phrase notes are split across voices, click **Assign note** →
  the suggested note moves into the target voice, becomes locked for re-runs,
  and the suggestion disappears if the phrase is no longer split.
- Suggestions never merge into/out of Percussion, and they do not propose
  edits for already-locked notes.

## Overlap conflicts

- If two non-percussion notes overlap in the same voice, the export readiness
  panel reports a same-voice overlap warning.
- Click **Next overlap (N)** → both conflicting notes become selected and the
  piano roll pans to the conflict. Repeated clicks step through conflicts.
- Percussion overlaps are ignored; simultaneous drum hits are expected.

## Re-run separation

- Make a few manual corrections, then click **Re-run separation** → the
  heuristic re-runs; manually corrected notes keep their assigned voice
  (treated as locked), unlocked notes get rescored.
- Set a value in the "Max voices" input, then re-run → the result never
  exceeds that many voices (existing voices get reused, forced at zero
  confidence, instead of creating new ones past the cap).
- Leave "Max voices" blank, re-run → no cap is applied.
- Re-run while a file is mid-import/export → button is disabled.

## Undo/redo

- After any correction (reassign, paint, merge, create voice, reorder,
  rename, apply pitch ranges, re-run separation), click **Undo** → the
  action reverts, including voice list/labels and (for pitch-range
  re-applies) which notes are still range-controlled.
- Click **Redo** → the undone action reapplies.
- Undo/redo via `Ctrl+Z` / `Ctrl+Shift+Z` → same behavior as the buttons.
- Undo with nothing in history / redo with nothing to redo → buttons are
  disabled, shortcuts no-op.
- Make a new correction after undoing → the redo stack clears (can't redo
  the old future after a new branch).

## Piano-roll pan/zoom

- `Ctrl`/`Cmd` + mouse wheel over the roll → zooms in/out anchored at the
  cursor position; the "Reset zoom (Nx)" button appears once zoomed in.
- Plain mouse wheel (vertical or horizontal/trackpad) → pans the visible
  window left/right.
- Click **Reset zoom** → returns to the default fully-zoomed-out view.
- The minimap (thin strip above the canvas) shows the current visible
  window as a highlighted region against the full timeline.
- Click anywhere on the minimap → pans the view to center on that point
  (and also seeks playback — see below).
- Tab-stepping to an off-screen flagged note → view auto-pans (without
  changing zoom) to bring it into view.

## Playback

- Click **Play** → audio starts from the current playhead position; button
  becomes "Pause"; the time readout (`mm:ss / mm:ss`) starts advancing.
- Click **Pause** → audio stops, playhead position is retained; button
  reverts to "Play". Clicking Play again resumes from where it paused.
- Click **Stop** → audio stops and the playhead resets to the start
  (`0:00`).
- While playing, the canvas playhead (vertical line) advances and the view
  page-follows it once it nears the edge of the visible window.
- Click the minimap while playback is stopped/paused → seeks the playhead
  to that position (and pans the view) without starting playback.
- Click the minimap while playing → seeks playback to that position
  immediately (audio jumps there).
- Solo a voice, then play → only that voice is audible.
- Each voice has a distinct, consistent waveform timbre matching its visual
  color/index.
- Play/Pause/Stop are disabled during import/export/re-run.

## Export

- Click **Export MIDI**, choose a destination → success message shows note
  count, track count, and the written path; the file is a valid format-1 SMF
  with a conductor track plus one note track per voice, reflecting every
  manual correction made so far.
- Cancel the export dialog → nothing happens, no error.
- Export fails (e.g. invalid path) → an inline error with code and message
  appears.

- Reimport the exported file through the native **Import MIDI** dialog → every note and voice track returns, labels remain meaningful, and the app shows no unexpected warnings.

## Cross-cutting / edge cases

- All of the above while a low-confidence/flagged note is selected — confirm
  the review-mode dashed outline and selection panel agree.
- Resize the app window → piano roll canvas and minimap resize correctly,
  no stale hit-testing.
- Rapidly chain several different correction types (reassign → paint →
  merge → pitch-range apply → re-run) then undo through all of them one at
  a time → state at each step matches what was actually done, in reverse
  order.

## Pending Feature 6 acceptance

Feature 6 implementation and the available non-browser gates are complete: `pnpm test` passed 562
unit tests, lint/typecheck/build passed, and Playwright discovery found 108 tests (106 before the
two E3 branch-isolation and pointer-cancel regressions). Real Playwright execution is not yet a
pass: the current browser quota blocked it, and there was no in-app browser target for the manual
ergonomics substitute.

Targeted Prettier checks for the Feature 6/E3 files pass. The repo-wide `pnpm format:check` still
reports only the pre-existing untouched `native-e2e/native-shell.e2e.mjs`; this Feature 6 slice
does not rewrite that unrelated native test.

When browser capacity is available, run:

```powershell
pnpm exec playwright test e2e/voice-lanes.e2e.ts e2e/split-screen.e2e.ts --workers=1
pnpm test:e2e
```

Then run `pnpm tauri dev` and complete the Feature 6 checklist above on sparse and dense real files,
including audition by ear. Record those results before calling Feature 6 fully accepted or starting
Feature 7.
