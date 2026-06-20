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

## Paint mode

- Click **Paint mode: off** to turn it on → button shows "Paint mode: on";
  a hint appears: "Click a voice swatch above to choose what to paint."
- Click a voice swatch while in paint mode → hint updates to "Click or drag
  to paint notes into <voice>."
- Click a note → it repaints into the active voice.
- Click-drag across several notes → all of them repaint into the active
  voice as the drag passes over them.
- Toggle paint mode off → returns to normal select/marquee behavior.
- Pressing `1`-`9` while in paint mode sets the active voice instead of
  reassigning a selection.

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

## Cross-cutting / edge cases

- All of the above while a low-confidence/flagged note is selected — confirm
  the review-mode dashed outline and selection panel agree.
- Resize the app window → piano roll canvas and minimap resize correctly,
  no stale hit-testing.
- Rapidly chain several different correction types (reassign → paint →
  merge → pitch-range apply → re-run) then undo through all of them one at
  a time → state at each step matches what was actually done, in reverse
  order.

## Known accepted gap

- No real dense chiptune `.mid` fixture has been used to validate
  performance directly — only synthetic stress fixtures (worth a manual
  spot-check if/when a suitably dense real file is available, per
  `agents.md`'s Progress Log).
