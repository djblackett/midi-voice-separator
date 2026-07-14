# Detailed Plan: Voice-Lane Editing Parity (Master-Plan Feature 6)

- Repository: `chiptune-voice-separator`
- Date: 2026-07-13
- Consumes: `NEXT_FEATURES_MASTER_PLAN.md` (M15), `SPLIT_SCREEN_PLAN.md` (M13),
  `KEYBOARD_COMMANDS_PLAN.md` (M14), and `AB_PLAYBACK_PLAN.md` (M10-M12).
- Status: Feature 6 implementation and all automated E3 gates are complete. Manual
  audio/ergonomics acceptance remains pending, so Feature 6 is not yet fully accepted.
- Verified entry boundary: Features 1-5 are complete at commit `461f8cf`
  (`feat: add independent A/B playback monitoring`).

---

## 1. Purpose and scope

Before Feature 6, the voice-lane view was useful for seeing assignment structure, but it was not
yet an editor peer of the piano roll. It rendered the same materialized project and supported point
selection/audition, while marquee selection, context assignment, smart selection, paint tools,
vertical reveal, and most geometry queries remained hard-wired to piano coordinates.

Feature 6 makes the two views alternate presentations of **one editor**, not two editors:

- one pointer/gesture controller;
- one selection state;
- one `EditorCommand` path and branch history;
- one set of mutation callbacks;
- view-specific geometry and explicit capabilities only where the pictures genuinely differ.

### In scope

- M15's shared view-geometry seam: gutter, note rectangles, point/rectangle hit testing,
  brush/lasso queries, reveal targets, and optional lane rows.
- A real vertical voice-lane viewport so a many-voice project can reach every lane.
- Click/Shift-click, marquee/Shift-marquee, audition, context assignment, musical smart
  selection, pencil, brush, lasso, and wand in both views.
- Existing number-key reassignment and undo/redo through the same App/editor command path.
- Capability-driven UI so an unsupported tool cannot look active while doing something else.
- Dynamic canvas accessibility and a keyboard-accessible lane-scroll control.
- Correct behavior in single and split comparison layouts.

### Explicit non-goals

- A second lane-specific reducer, command set, history, or branch model.
- Dragging notes to change pitch, time, or duration. This app edits voice assignment, not MIDI
  performance data.
- New separation heuristics, lane reordering, or voice creation semantics.
- Giving pitch-range markers a synthetic lane meaning. Range markers remain piano-only.
- Feature 7 content-based note matching or cross-import lane alignment.
- Raw pixel-linked A/B lane scrolling when the sides have different voice order. Linked lane
  navigation must use voice correspondence or fall back to independent panes.
- Rust/Tauri changes. This feature is frontend geometry, interaction, and pane state.

---

## 2. Pre-implementation baseline (verified from code)

### What is already shared and should stay shared

- `PianoRoll.tsx` is already the single canvas gesture component. Do not fork it.
- App passes the same `onSelectionChange`, `onPaintNotes`, `onAssignNotes`, and
  `onAuditionNotes` callbacks regardless of view.
- Number-key reassignment operates on `selectedNoteIds`, so it is view-independent once lane
  selection reaches parity.
- Both renderers consume the same materialized project, selection, solo, diff, confidence,
  presentation-key, and playhead data.
- Split panes already share the time viewport and authorize mutations against the active side.

### Concrete gaps

1. **Geometry is duplicated and can drift.** Piano note rectangles are independently recreated
   in `drawPianoRoll.ts`, `hitTest.ts`, and `paintBrush.ts`. Lane drawing uses
   `voiceLaneNoteRect`, while lane hit testing rebuilds its own layout.
2. **Lane gestures are special-cased.** Lane mode has hover, click/Shift-click, and click
   audition. Drag is explicitly ignored; context menu, double-click, and every paint query are
   gated to piano mode.
3. **Paint can enter a dead state.** App forces toolbar paint to piano and forces lane entry back
   to Select, but keyboard P/B/L/W can still show Paint as active while `PianoRoll` refuses to
   run a lane paint cursor.
4. **Lower lanes are clipped.** `buildVoiceLaneLayout` enforces a 36px minimum row height and can
   return rows below the canvas. `.piano-roll-shell` hides overflow, and there is no vertical
   offset or selected-lane reveal.
5. **The active gutter is not a contract.** Lane drawing uses 96px; piano/ruler/zoom calculations
   often assume 56px. This can offset time ruler, seek, and zoom anchors in lane mode.
6. **Vertical input remains pitch-specific.** Shift-wheel and Ctrl/Cmd+Shift-wheel mutate the
   pitch viewport even while lanes are visible, producing no useful visible result.
7. **Accessibility describes the wrong view.** The canvas is always labelled "Piano roll note
   visualization" and lane labels exist only as pixels. A wheel-only vertical viewport would
   also be inaccessible.

---

## 3. Target architecture

### 3.1 Bound view geometry (M15)

Add `src/features/piano-roll/viewGeometry.ts`. A factory binds a materialized project and the
current canvas viewport once; every draw/query path then reads the same rectangles.

```ts
export type EditorViewKind = "piano" | "voice-lanes";

export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ViewCapabilities {
  readonly clickSelection: boolean;
  readonly marqueeSelection: boolean;
  readonly contextActions: boolean;
  readonly audition: boolean;
  readonly pencil: boolean;
  readonly brush: boolean;
  readonly lasso: boolean;
  readonly wand: boolean;
  readonly pitchRangeMarkers: boolean;
  readonly verticalAxis: "pitch" | "lanes";
}

export type VerticalRevealTarget =
  | { kind: "pitch"; lowestPitch: number; highestPitch: number }
  | { kind: "lanes"; voiceIds: readonly string[] };

export interface ViewRevealTarget {
  readonly startTick: number;
  readonly endTick: number;
  readonly vertical: VerticalRevealTarget;
}

export interface ViewGeometry {
  readonly kind: EditorViewKind;
  readonly gutterWidth: number;
  readonly capabilities: ViewCapabilities;
  readonly laneRows: readonly VoiceLane[] | null;
  noteRect(note: MidiNote): ScreenRect | null;
  revealTarget(notes: readonly MidiNote[]): ViewRevealTarget | null;
}
```

Factories:

```ts
createPianoViewGeometry(project, viewport): ViewGeometry;
createVoiceLaneViewGeometry(project, viewport, laneViewport): ViewGeometry;
```

Generic helpers operate only on `ViewGeometry.noteRect`:

- `hitTestNoteAtPoint`;
- `hitTestNotesInRect`;
- `notesInBrushStampForView`;
- `notesInLassoPathForView`.

They receive the permitted `readonly MidiNote[]` query set explicitly. Geometry owns layout, not
interaction authorization: filtered modes such as "only changed notes" can render the full project
while ensuring hidden notes never become selectable or paintable.

The deterministic overlap rule remains the current rule: shortest duration first, then latest
start, then highest pitch, then stable note id. A rectangle completely hidden behind the active
gutter is not interactive. Rendering, hit testing, brush, and lasso must agree on that rule.

Compatibility wrappers in `hitTest.ts` and `paintBrush.ts` may remain temporarily, but after
migration they must delegate to this geometry rather than reproduce coordinates.

### 3.2 One capability matrix, current and target behavior made explicit

The target matrix is:

| Capability                                  | Piano | Voice lanes |
| ------------------------------------------- | :---: | :---------: |
| Click / Shift-click selection               |  yes  |     yes     |
| Marquee / Shift-marquee selection           |  yes  |     yes     |
| Click audition                              |  yes  |     yes     |
| Number-key reassignment                     |  yes  |     yes     |
| Context Assign to                           |  yes  |     yes     |
| Chord / phrase / top-bottom smart selection |  yes  |     yes     |
| Pencil / brush / lasso / wand               |  yes  |     yes     |
| Horizontal time pan/zoom, ruler, minimap    |  yes  |     yes     |
| Vertical navigation                         | pitch |    lanes    |
| Pitch-range markers                         |  yes  |     no      |

App and `PianoRoll` consume the same matrix. UI controls use it to disable or explain a genuine
exception; they do not silently switch views or leave an inert tool active.

Range-to-lane transitions are explicit and symmetric. While Range is active, the Voice lanes
button is disabled with help that says to exit Range first. While voice lanes are visible, the
Range control is disabled with help that says to switch to Piano roll first. Neither control
silently changes the view or interaction mode on the user's behalf.

### 3.3 Lane viewport is pane UI state, not editor state

Add `src/features/piano-roll/laneViewport.ts`:

```ts
export interface LaneViewportWindow {
  readonly scrollTopPx: number;
}

export interface ResolvedLaneViewport {
  readonly laneHeight: number;
  readonly contentHeight: number;
  readonly scrollTopPx: number;
  readonly maxScrollTopPx: number;
}
```

Rules:

- `laneHeight = max(36, canvasHeight / max(1, voiceCount))`;
- `contentHeight = laneHeight * voiceCount`;
- scrolling clamps to `0...max(0, contentHeight - canvasHeight)`;
- layout y is `rowIndex * laneHeight - scrollTopPx`;
- only rows intersecting the viewport are drawn or hit-tested;
- selection reveal pans the selected voice row into view with a small margin;
- resize, import, and voice-count/order changes reconcile the scroll offset rather than leaving
  a blank canvas.

No lane-row zoom is added in Feature 6. The requirement is a real reachable viewport, not another
zoom dimension. Shift-wheel pans the active vertical axis: pitch in piano mode, rows in lane mode.
An accessible range/scrollbar control mirrors lane position for keyboard users.

`PianoRoll` gains controlled/uncontrolled `laneViewport` props parallel to time/pitch viewport
props. This remains pane presentation state and never enters `EditorDocument`, snapshots,
comparison workspace data, or history.

### 3.4 Split-pane lane linking is correspondence-aware

Independent lane scrolling remains the default. If the user enables linked vertical navigation,
do not share raw `scrollTopPx`: A and B may order or allocate voices differently.

Instead:

1. identify the top/anchor voice on the source side;
2. map it through `comparisonProjection.correspondence`;
3. reveal that matched voice in the other pane;
4. keep the other pane independent when no unambiguous counterpart exists.

The existing pitch-link control becomes a view-aware vertical-link control. Its label must say
what is linked (pitch or lanes), and the projection supplies correspondence only--never a stored
lane layout.

### 3.5 One gesture controller and one mutation path

`PianoRoll.tsx` resolves one `viewGeometry` per render. Pointer handlers call generic geometry
queries and then the existing selection/paint callbacks. View-specific branches remain only for
real capabilities such as pitch-marker drag and vertical-axis navigation.

Both views therefore emit the same App/editor actions:

```text
pointer gesture
  -> geometry query
  -> selection or existing App callback
  -> EditorCommand against the active branch
  -> one branch-local undo entry
```

No lane-specific mutation callback is added.

### 3.6 Paint preview stays geometrically stable during a stroke

When a lane paint stroke reassigns a note, its preview changes to the target voice color but stays
in its source lane until release. The actual command then commits the assignment and the next
render moves it atomically to the target lane.

Moving the note between rows during an in-progress stroke would move the pointer target out from
under the brush and make lasso membership unstable. This is an explicit interaction invariant and
a manual-test pause point.

### 3.7 Accessibility contract

- Canvas label is dynamic: "Piano roll note visualization" or "Voice lane note visualization".
- `PianoRoll` accepts an optional accessible label prefix. Single-pane mode uses the dynamic label
  directly; split mode passes "Side A" or "Side B", producing names such as "Side A piano roll
  note visualization" and "Side B voice lane note visualization".
- Split pane group labels remain side-qualified and reflect the active view.
- Lane scroll has a keyboard-accessible range/scrollbar equivalent with current/min/max values.
- Toolbar controls explain the symmetric Range/view restriction instead of silently changing view.
- Context actions remain keyboard-focusable HTML, not canvas-only text.

---

## 4. Migration strategy

1. Introduce pure geometry and capability contracts with both adapters, initially unwired.
2. Migrate existing piano drawing/hit/paint/ruler math to the geometry without changing intended
   editor behavior; explicitly correct the current gutter overdraw/edge-hit inconsistency.
3. Add and wire pure lane viewport math before enabling gestures that could target clipped rows.
4. Route existing lane click/hover and new marquee/context gestures through the same controller.
5. Enable paint tools through generic geometry only after preview placement is stable.
6. Finish split linking, accessibility, capability UI, and broad/manual regression coverage.

At no point should two gesture controllers or two mutation paths coexist.

---

## 5. Commit-sized slices

Each slice is one focused commit. At the start of every slice run `git status --short`; before
commit run the focused tests plus `pnpm test`, `pnpm lint`, targeted Prettier, and `pnpm build`.
No Rust checks are required unless a later slice unexpectedly changes `src-tauri`.

### Phase A - M15 geometry seam (behavior-preserving except canonical gutter clipping)

- **A1. Pure `ViewGeometry` contract and adapters (unwired).** Add canonical piano and current
  lane note rectangles, common point/rectangle/brush/lasso queries, capability data, lane rows,
  and reveal targets. Unit-test both adapters, overlap ordering, gutter clipping, orphan voices,
  inverted rectangles, fast brush sweeps, lasso intersections, and reveal semantics.
- **A2. Migrate piano drawing and compatibility wrappers.** Route `drawPianoRoll`, `hitTest.ts`,
  `paintBrush.ts`, ruler tick conversion, zoom anchors, and pan width through the canonical piano
  geometry. Make the legacy `PIANO_ROLL_LABEL_WIDTH` export an alias of the canonical gutter during
  migration, then remove the duplicate authority. Delete duplicated rectangle math. Existing
  pixel/math and Playwright behavior stays unchanged apart from the explicit rule that notes cannot
  draw or hit-test behind the active gutter.
- **A3. Bind `PianoRoll` to one geometry resolver.** Existing hover/click behavior in both views
  uses the same point-query path. Route `drawTimeRuler`, ruler seek conversion, Ctrl/Cmd zoom
  anchors, and horizontal pan-width math through the active geometry's `gutterWidth`; add a 96 px
  lane-gutter alignment regression. Add the capability resolver but do not enable new gestures yet.

### Phase B - Real vertical lane viewport

- **B1. Pure lane viewport math.** Add resolve/clamp/pan/reveal/reconcile functions and tests for
  zero/one/many voices, first/middle/last row reveal, resize, and voice-order changes.
- **B2. Render and hit-test scrolled lanes.** Pass the resolved window into lane geometry and
  drawing; clip offscreen rows intentionally. Add Shift-wheel row scrolling, selected-lane reveal,
  reset behavior, and an accessible scroll control.
- **B3. Controlled split-pane lane viewport.** Add lane viewport props/state parallel to pitch,
  keep panes independent by default, and make the vertical-link control view-aware. Linked rows
  use correspondence anchors, with an explicit unmatched fallback.

### Phase C - Shared selection and context gestures

- **C1. Click/Shift/marquee parity.** Remove the lane drag early-return. Both modes resolve click
  and marquee membership through the active geometry and the same `resolveSelection` call. Draw
  the common marquee preview in lane mode.
- **C2. Audition and smart/context parity.** Enable right-click Assign to, chord/phrase/top-bottom
  actions, and double-click chord selection in lanes using the same anchor hit. No new App handler.
- **C3. Command equivalence regression.** Parameterized geometry-query and callback-contract tests
  assert that equivalent piano and lane targets produce identical selected note ids / App callback
  payloads. Playwright drives the real gestures and proves number-key and context reassignment each
  make one undoable edit.

### Phase D - Paint parity

- **D1. Pencil and wand anchors.** Use the active geometry's point query; retain one stroke/one
  undo and the existing audition throttling.
- **D2. Brush and lasso geometry.** Use generic capsule/polygon queries over canonical note rects.
  Preview target color in the source lane; reflow only after commit.
- **D3. Capability-driven paint UI.** Remove forced-piano paint and forced-Select lane switching.
  P/B/L/W and toolbar controls behave identically in lanes. Range remains visibly piano-only, with
  the symmetric disabled controls and explanatory help defined in section 3.2.

### Phase E - Accessibility, visual parity, and exit gate

- **E1. Dynamic canvas semantics and lane navigation UI.** Add the view-specific canvas name,
  side-qualified split-canvas names, accessible lane-scroll values, and contextual toolbar help.
- **E2. Common render cues.** Confirm selection, solo dimming, confidence heat, changed-note edge,
  conflict cue, playhead, and paint preview are consistent in both views.
- **E3. Full regression and manual ergonomics pass.** Run full unit/Playwright/build gates and
  manually test brush radius across lane boundaries, lasso stability, last-lane reachability,
  fullscreen, split A/B, and audition by ear.

### E3 closure record (2026-07-13)

Feature 6 implementation is complete through the E3 regression additions. The commit-sized
implementation boundary before E3 is:

| Slice | Commit    | Slice | Commit    | Slice | Commit    |
| ----- | --------- | ----- | --------- | ----- | --------- |
| A1    | `abed4fe` | B1    | `b9785cd` | C1    | `06ab80f` |
| A2    | `f8b1059` | B2    | `6321728` | C2    | `8a4df41` |
| A3    | `08966fa` | B3    | `41a23e5` | C3    | `46d60cf` |
| D1    | `539d487` | D2    | `13f4af1` | D3    | `925cea6` |
| E1    | `6851725` | E2    | `6d12081` |       |           |

The E3 closure slice adds two explicit regressions beyond the earlier 106-test Playwright suite:

- a split voice-lane edit mutates only active side B, creates history only on B, and leaves side A
  and its undo stack unchanged;
- a `pointercancel` during a lane brush stroke clears the gesture, preview, and pointer state
  without committing an assignment or creating history.

Completed automated evidence:

- `pnpm test` — 601 unit tests passed;
- `pnpm lint` — passed;
- `pnpm build` — passed;
- targeted Prettier checks for every Feature 6/E3 file — passed;
- `pnpm test:e2e -- --workers=1` — all 108 serial Chromium tests passed.

The repo-wide `pnpm format:check` still reports the pre-existing untouched
`native-e2e/native-shell.e2e.mjs`; E3 does not rewrite that unrelated native test. This slice's
targeted formatting gate is clean.

The former deterministic fullscreen regression is fixed. Fullscreen intentionally covers the
outside voice legend and header Undo control, so the split-lane regression now selects the active
pane's in-canvas voice control and invokes the existing `Ctrl+Z` undo command. The in-canvas
control is explicitly named `Select <voice> voice` to avoid colliding with legacy voice-swatch and
toolbar selectors. The Feature 6 browser slice (`e2e/voice-lanes.e2e.ts` plus
`e2e/split-screen.e2e.ts`) passed 22/22 serial Chromium tests before the complete 108/108 run.

The audio and interaction-quality pause points also remain pending. Run `pnpm tauri dev` and work
through the Feature 6 section in `MANUAL_TEST_CASES.md`, including audition by ear, brush/lasso
ergonomics, last-lane reachability, fullscreen, and split A/B behavior. Until that manual
acceptance is recorded, Feature 6 is implemented and fully automated but not fully accepted.

---

## 6. Contract-to-slice matrix

| Contract / requirement                         | Slices       |
| ---------------------------------------------- | ------------ |
| M15 gutter + note rectangle contract           | A1-A3        |
| M15 point and rectangle hit testing            | A1-A3, C1    |
| M15 brush and lasso queries                    | A1-A2, D1-D2 |
| M15 reveal/pan behavior                        | A1, B1-B3    |
| M15 optional lane-row layout                   | A1, B1-B2    |
| One gesture controller / identical commands    | C1-C3, D1-D3 |
| Real vertical lane viewport                    | B1-B3        |
| Explicit capability matrix / pitch-only ranges | A1, D3, E1   |
| Split side qualification and linked navigation | B3, E1       |
| Accessibility                                  | B2, E1       |

---

## 7. Verification strategy

### Vitest

- Geometry: identical draw/hit rectangles, active gutters, deterministic overlap priority,
  forward/inverted rectangle queries, brush capsule, lasso enclosure/intersection, lane/orphan
  rows, reveal targets, and capability matrix.
- Lane viewport: content height, clamp, pixel pan, first/middle/last reveal with margin, resize,
  voice removal/reorder reconciliation, and offscreen rows excluded from queries.
- Gesture equivalence: equivalent piano/lane geometry queries and callback contracts produce the
  same note ids and mutation payloads for every common capability.

### Playwright

- Shift-click and marquee select the expected lane notes.
- Number-key and context assignment in lanes each create one undoable edit.
- Pencil, brush, lasso, and wand mutate through the lane view and undo as one stroke.
- A 12+ voice fixture scrolls to and selects the final lane; external selection auto-reveals it.
- Toolbar and P/B/L/W never produce an active-but-inert lane tool.
- A 96 px lane gutter keeps ruler ticks, seek clicks, zoom anchors, and horizontal pan aligned.
- Dynamic canvas accessibility, exact side-qualified split names, and keyboard lane scrolling.
- Active split pane mutates; inactive pane remains read-only; linked lane navigation uses matched
  voices and degrades safely when unmatched.
- Existing piano interaction, viewport, playback, and comparison specs remain green.

### Manual pause points

- Lane row height/scroll feel with sparse and dense real files.
- Brush crossing adjacent lane boundaries and source-lane preview stability.
- Lasso ergonomics near a clipped row edge.
- Fullscreen and split-pane lane navigation.
- Audition by ear and playhead alignment after horizontal zoom/pan.

---

## 8. Mandatory regression scenarios

- The same common gesture produces the same editor command in piano and lane views.
- A lane edit affects only the active comparison branch and creates one undo entry.
- Pitch-range markers cannot be changed from lane mode.
- Range and Voice lanes controls require an explicit mode/view exit and never switch silently.
- Notes completely hidden behind a gutter or outside the vertical lane window are not hit.
- Selecting a lower-lane note reveals it without changing horizontal zoom.
- Changing voice assignment during a paint preview does not move the hit target before commit.
- A/B lane navigation never relates voices by raw id or raw row offset.
- Time ruler, seek, minimap, playhead, and horizontal zoom use the active view's gutter.
- Existing piano behavior remains unchanged during the geometry migration apart from canonical
  clipping that prevents notes drawing or hit-testing behind the active gutter.

---

## 9. Rollback and failure behavior

- A1 is pure and unwired; reverting it has no product behavior impact.
- A2 keeps compatibility wrappers until every consumer is migrated, allowing one-slice rollback.
- Invalid lane scroll values clamp rather than render a blank canvas.
- Missing/orphan voice rows return `null` geometry and cannot mutate a hidden note.
- An unmatched split lane anchor leaves the other pane at its independent viewport and reports
  that linked navigation could not resolve a counterpart.
- Read-only comparison panes may pan/scroll and audition where already allowed, but mutation
  callbacks remain disabled by active-side authorization.

---

## 10. Resolved decisions

1. **One component/controller, geometry adapters only.** No lane editor fork.
2. **Pixel scroll, no lane zoom in Feature 6.** Rows auto-fill when sparse and keep a 36px minimum
   when dense.
3. **Source-lane paint preview.** Reflow occurs atomically after command commit.
4. **Pitch-range markers remain piano-only.** This is an explicit capability, not a hidden mode
   switch.
5. **Independent split lane viewports by default.** Optional linking maps an anchor voice through
   correspondence; raw offsets are forbidden.
6. **App/editor commands remain unchanged.** Geometry decides what was touched, never what
   mutation means.
7. **Feature 6 owns accessibility for its new viewport.** Wheel-only navigation is insufficient.
8. **Range/lane transitions require an explicit user action.** The incompatible destination
   control is disabled with an explanation; no implicit mode or view switch is permitted.

---

## 11. Boundary handed to Feature 7

With Feature 6 implemented, piano and voice-lane views are two geometry adapters over one
interaction and editor-command system, with reachable lane rows and explicit capabilities. Once
the pending E3 runtime and manual acceptance is recorded, Feature 7 can add content-based note
correspondence without needing to know which editor view produced a selection or correction.

Feature 7 has not started.

No lane layout, viewport, or gesture state becomes part of note identity or content matching.
