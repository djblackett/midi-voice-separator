# Next Features Architecture Master Plan

Repository: `chiptune-voice-separator`  
Date: 2026-07-10  
Baseline commit: `a3e5fe9` (`Add comparison workflow end-to-end coverage`)  
Status: Features 1-5 complete. Feature 6 implementation and non-browser E3 gates are complete;
real Playwright found one deterministic fullscreen split-lane regression, and manual
audio/ergonomics acceptance remains pending. Feature 7 has a detailed plan but implementation has
not started.

## Purpose

This document is the durable architecture contract for the next feature sequence:

1. Cost-based assignment metric.
2. Editable side B.
3. Split-screen comparison.
4. Keyboard side switching.
5. A/B playback.
6. Voice-lane editing parity.
7. Content-based note matching.
8. Cross-import diffing.
9. Automated export-to-reimport verification.

### Implementation checkpoint (2026-07-13)

| Feature                         | Status                                            | Terminal boundary                      |
| ------------------------------- | ------------------------------------------------- | -------------------------------------- |
| 1. Cost-based assignment metric | Complete                                          | `2844dd0`                              |
| 2. Editable side B              | Complete                                          | `48af621`                              |
| 3. Split-screen comparison      | Complete                                          | `2e6dc1d`                              |
| 4. Keyboard side switching      | Complete                                          | `f52756c`                              |
| 5. A/B playback                 | Complete                                          | `461f8cf`                              |
| 6. Voice-lane editing parity    | Implemented; E3 runtime/manual acceptance pending | E2: `6d12081`; E3: this closure commit |
| 7. Content-based matching       | Detailed plan drafted; implementation not started | —                                      |

Feature 6 is tracked in `VOICE_LANE_PARITY_PLAN.md`. Its available automated evidence is 562
passing unit tests, passing lint/typecheck/build, and discovery of all 108 Playwright tests (106
before the two E3 regressions). A 2026-07-13 real serial Chromium run reached the suite but failed
one deterministic fullscreen split-lane interaction test (107/108 passed; the Side A canvas
intercepted a visible voice-swatch click). The manual audio/ergonomics pass is also outstanding.
This checkpoint therefore does not call Feature 6 fully accepted or authorize Feature 7
implementation. `CONTENT_BASED_NOTE_MATCHING_PLAN.md` is the detailed plan for Feature 7.

`PLAN.local.md` records the completed snapshots/diff/read-only-compare roadmap. Do not
overwrite or reinterpret it as the implementation plan for the work above. Each feature in
this document will receive its own detailed, commit-sliced plan later.

The central architecture decision is:

> A and B may be two branches of editor data, but there must be exactly one editor model,
> one reducer/command system, one history implementation, and one materialization pipeline.
> Comparison remains a pure projection over branch references.

## Master Dependency Order

```text
Versioned cost evaluator
        |
        v
Atomic editor/branch foundation + honest assignment provenance
        |
        v
Editable B -> split screen -> keyboard switching -> A/B playback
        |
        v
Voice-lane editing parity
        |
        v
Content correspondence -> cross-import diff -> round-trip verification
```

The editor/branch foundation is not a separate product feature. It is the required first
part of the editable-B plan. Likewise, strict round-trip matching may receive backend
contract tests while the matcher is built, but the user-facing verification workflow stays
after cross-import diffing.

## Current Architecture Baseline

The current implementation already has several boundaries worth preserving:

- Imported and rerun `MidiProject` values are treated as immutable values; a rerun replaces
  the value rather than mutating it in place.
- The effective assignment is `voiceOverrides[note.id] ?? note.voiceId`.
- `displayedProject` applies overrides and rebuilds the voice list from `voiceOrder` and
  `voiceLabels`.
- `EditorSnapshot` already captures the five fields that form the effective editor value:
  `project`, `voiceOverrides`, `voiceOrder`, `voiceLabels`, and
  `rangeAssignedNoteIds`.
- Named snapshots are immutable captures of that editor value.
- Assignment comparison is derived from materialized sides rather than raw override maps.
- Playback scheduling and most MIDI/editor calculations are isolated in pure helpers.
- The frontend has Playwright coverage, while WDIO now exercises the compiled Tauri app and
  real IPC commands.

The main scaling risk is `src/app/App.tsx`: it currently owns roughly 39 state atoms and 44
local handlers. Most editor operations manually push history and then fan out across
multiple state setters. Editable B must not double that structure.

## Binding Architecture Contracts

Later feature plans must reference and preserve these contracts. Changing one requires an
explicit architecture review rather than an incidental implementation choice.

### M1 - `EditorDocument` is the atomic editable value

Promote the existing `EditorSnapshot` shape into the canonical editor aggregate and add
identity and provenance:

```ts
interface EditorDocument {
  documentId: DocumentId;
  revision: number;

  project: MidiProject;
  voiceOverrides: VoiceOverrides;
  voiceOrder: readonly string[];
  voiceLabels: Readonly<Record<string, string>>;
  rangeAssignedNoteIds: ReadonlySet<string>;

  assignmentProvenance: AssignmentProvenance;
}
```

All five correction fields change atomically. `rangeAssignedNoteIds` must remain a subset
of the override keys. The current full-project snapshot approach is acceptable; this work
does not require a speculative normalization of every note and assignment into a new store.

### M2 - Both sides use one branch type and one command system

```ts
interface EditorBranch {
  branchId: BranchId;
  present: EditorDocument;
  history: EditorHistory;
  forkedFrom: SnapshotId | BranchRevisionRef;
}
```

Side B is forked from an immutable named snapshot. Editing B never edits that snapshot.
Both A and B use the same reducer, command definitions, history logic, materializer,
diagnostics, and rerun pipeline.

Do not add parallel fields such as `bProject`, `bOverrides`, or B-specific copies of every
handler to `App.tsx`.

### M3 - Every editor mutation is one pure transaction

The editor boundary is:

```text
EditorDocument + EditorCommand -> EditorDocument
```

History wraps that transition. Buttons, keyboard commands, canvas gestures, context-menu
actions, review actions, smart fixes, snapshot restore, and rerun results must all use the
same command path.

This also closes existing inconsistencies such as voice rename not entering history and the
number-key reassignment path duplicating assignment bookkeeping.

### M4 - Comparison state stores references, never editor copies

```ts
interface ComparisonWorkspace {
  sideA: BranchRef;
  sideB: BranchRef;
  activeSide: "A" | "B";
  monitorSide: "A" | "B";
  layout: "single" | "split" | "diff";
  linkTimeViewport: boolean;
}
```

The comparison workspace may own references and presentation choices. It must not own
copied projects, override maps, diffs, scores, correspondence results, or playback note
lists.

A derived `ComparisonProjection` resolves the materialized sides, correspondence, diff,
metrics, presentation mapping, capabilities, and playback sources.

### M5 - Branch lifecycle is explicit

- Starting editable B forks the selected snapshot.
- The source snapshot remains immutable.
- `Use B` promotes B to the primary working result and preserves A as a snapshot.
- `Keep A` discards B only after the dirty branch is explicitly handled.
- Saving B as a snapshot is explicit.
- Exiting comparison never silently loses B edits.
- Export clearly identifies which branch is being exported; it must not depend on whichever
  canvas happened to render last.

No automatic merge is planned. Assignments and voice metadata can conflict, so promotion is
an explicit whole-branch decision.

### M6 - Assignment provenance, rerun presets, and evaluation profiles are separate

These are different concepts:

| Concept                | Meaning                                                       |
| ---------------------- | ------------------------------------------------------------- |
| `AssignmentProvenance` | How the current algorithmic assignment was actually generated |
| `RerunPreset`          | UI settings requested for the next rerun                      |
| `EvaluationProfile`    | Versioned rules used to score an existing assignment          |

The current code does not maintain this distinction reliably:

- Generic import assignment actually uses Balanced + Greedy, but the import snapshot is
  labeled with the suggested strategy.
- The live diff reads current dropdown values as if they produced the current assignment.
- A before-rerun snapshot is labeled with the newly requested settings rather than the
  settings that produced its existing assignment.

`AssignmentProvenance` should be backend-produced and include an origin, actual strategy and
mode where applicable, max-voice cap, and algorithm version. Imported app-exported voice
tracks need a non-heuristic provenance kind. Manual corrections remain represented by the
correction layer and do not rewrite how the base assignment was generated.

### M7 - Async editor results are revision guarded

Every async operation that can replace editor state carries:

- target `branchId`;
- starting document `revision`;
- request ID.

The result applies only if it still targets the same branch revision. Otherwise it is
discarded or enters an explicit conflict path. Central command authorization must cover
buttons, shortcuts, canvas gestures, context menus, and smart-fix actions while the branch
is busy.

This is required because the current rerun awaits IPC while some keyboard and canvas edits
can still occur.

### M8 - Note and voice identifiers are side scoped

Existing note IDs are local import addresses, not global content identity:

```ts
type NoteRef = { documentId: DocumentId; noteId: string };
type VoiceRef = { sideId: SideId; voiceId: string };
```

Keep the parser's current note IDs for local lookup. Do not try to make them globally stable.
Voice IDs are also local to one assignment revision and must not be treated as durable across
reruns or imports.

### M9 - Voice correspondence is shared infrastructure

Voice correspondence must become deterministic maximum-weight bipartite matching over
matched-note overlap. The current greedy largest-overlap-first matcher can choose a globally
inferior pairing.

The result exposes:

- matched voice pairs;
- unmatched voices;
- overlap weights;
- ambiguity/ties;
- split and merge evidence.

Correspondence is reused for diffing, voice metadata reconciliation, split-screen
presentation, linked selection, solo mapping, and A/B timbre mapping.

After a rerun, labels, order, active voice, and solo state must be reconciled through this
mapping rather than carried forward by raw voice ID.

### M10 - Visual and audible identity comes from presentation keys

Raw voice IDs currently determine both canvas colors and chiptune waveforms. That can make a
matched voice change color and timbre between A and B even when its musical role is stable.

Derive `presentationKeyByVoiceId` from voice correspondence:

- A voices receive canonical A keys.
- Matched B voices reuse their A partner's key.
- Unmatched B voices receive stable B-local keys.
- Percussion retains a semantic presentation key.

Rendering and playback consume presentation keys without rewriting domain voice IDs.

### M11 - One workspace projection controls render, edit, and playback targets

The workspace must not independently decide which project is rendered, which branch receives
commands, and which side plays. A single resolver returns:

- visible sides;
- active editor side;
- monitored side;
- side materializations;
- permissions;
- side-local selection, solo, and scope;
- presentation mappings;
- source revision identities.

This prevents the current failure mode where B can be visible while playback remains
scheduled from A.

### M12 - Playback has one transport and replaceable side sources

Do not create one audio engine per pane.

Transport owns playing state, canonical tick, the audio-clock anchor, seek, stop, and source
replacement. A derived `PlaybackSource` contains:

- side and branch revision identity;
- materialized notes;
- tempo map;
- resolved scope and solo target;
- voice presentation/timbre mapping.

Switching A/B while playing reschedules from the current tick, keeps Stop available, and
visibly reports the monitored side. Initially A/B playback requires the same document
lineage. Cross-import synchronized playback remains out of scope until timeline alignment has
defined semantics.

The playback hook must invalidate on source/revision identity, not only filename and duration.

### M13 - Split panes have explicit, side-qualified UI state

Pane state is separate from editor-document state and includes side reference, selection,
active/solo voice, viewport, view mode, and tool drafts where appropriate.

Split screen requires:

- a controllable horizontal time viewport;
- linked time windows by default;
- an explicit choice for linked versus independent pitch/lane scrolling;
- side-qualified accessible canvas names;
- active-side focus that is visible without inferring DOM focus;
- linked selection derived through note correspondence.

All surrounding inspectors and editing panels bind to the active branch, not permanently to A.

### M14 - Keyboard input goes through a command registry

Commands are separate from bindings. The registry resolves:

- active side;
- read/write permissions;
- input/contenteditable focus;
- key repeat behavior;
- busy operations;
- mutating versus non-mutating commands.

Authorization occurs before any mutation, including undo/redo. This closes the current hidden
undo leak in read-only compare.

Bare `B` is already the Brush shortcut, so comparison switching must receive non-conflicting
bindings in its individual plan rather than overriding Brush accidentally.

### M15 - Piano and lane views share interaction commands and geometry contracts

Voice-lane parity must not duplicate the piano-roll gesture controller. Extract a view
geometry interface covering:

- gutter width;
- note rectangles;
- point and rectangle hit testing;
- brush and lasso queries;
- reveal/pan behavior;
- optional lane-row layout.

Both views emit the same editor commands. A capability matrix defines intentional exceptions.
Pitch-range markers are global pitch-axis operations and remain piano-only unless a meaningful
lane interpretation is designed.

Voice lanes also need a real vertical lane viewport. The current minimum lane height can put
lower lanes beyond the canvas and clip them.

### M16 - Content matching is a versioned correspondence service

The canonical note atom excludes `id`, `voiceId`, `sourceTrackIndex`, confidence, and reason.
It includes pitch, channel, velocity, and start/end positions normalized as rational
quarter-note coordinates. `durationTicks` is redundant.

Provide two distinct policies:

1. Strict round-trip matching: exact supported content and multiplicity.
2. Cross-import matching: exact buckets first, then sparse tolerant matching with explicit
   onset/duration thresholds and confidence.

The result reports exact, fuzzy, ambiguous, and unmatched notes; per-side coverage; matcher
version; policy; and paired side-specific note references.

Duplicate notes are multisets. Ambiguity is reported rather than hidden with arbitrary
occurrence numbers.

### M17 - Cross-import comparison uses a read-only reference document

Loading a comparison import must not call the normal replace-current-import path, clear the
active editor, or discard snapshots.

An external import enters comparison as a read-only `ReferenceDocument`. Promoting it into an
editable branch is a separate explicit operation outside the initial cross-import-diff scope.

Diff output generalizes from one list of local `changedNoteIds` to paired side references plus
side-specific unmatched lists. Voice correspondence consumes matched note pairs instead of
equal IDs. UI reports coverage and ambiguity before presenting reassignment counts as
authoritative.

### M18 - Round-trip verification checks the supported model, not byte identity

The authoritative backend pipeline is:

```text
validate materialized project
    -> encode export
    -> parse encoded/written bytes
    -> strict correspondence
    -> semantic verification report
```

The supported preservation contract includes:

- PPQ and modeled duration;
- note pitch/channel/velocity/start/end multiplicity;
- voice partition up to correspondence;
- supported labels and voice roles;
- tempo changes;
- time signatures.

It explicitly does not promise preservation of:

- note IDs, voice IDs, or source-track indices;
- original SMF format or track layout;
- confidence, reason codes, locks, or range provenance;
- program changes, controllers, pitch bend, SysEx, lyrics, key signatures, note-off velocity,
  or other events absent from the application DTO.

The report is structured: matched/missing/unexpected/ambiguous notes, partition differences,
label and timeline-metadata differences, matcher version, and expected transformations. A
tolerant cross-import policy must never be used to excuse strict export corruption.

Before the UI can claim `Verified`, implementation must resolve or explicitly report current
fidelity gaps:

- exported percussion reimports as a generic `voice-N`;
- empty voices disappear;
- duplicate labels can be rewritten;
- unlisted voice notes create an additional track while the reported track count remains
  `voices + 1`;
- zero-length notes are vulnerable to off-before-on ordering;
- overlapping duplicate notes with equal channel and pitch can exchange end times under FIFO
  pairing.

Percussion should ultimately become an explicit semantic voice role rather than relying only
on the literal ID `percussion`.

## Feature Gates and Exit Criteria

These are architecture-level gates, not the later commit-sized plans.

### 1. Cost-based assignment metric — complete

Required work:

- Add a pure Rust evaluator and versioned DTO.
- Evaluate fully materialized assignments.
- Normalize time with PPQ.
- Exclude/handle percussion explicitly.
- Return component breakdown and hard violations.
- Keep evaluation profile independent from generation provenance.
- Cache only as derived state keyed by branch revision and metric version.

Do not directly expose the private test helper
`total_cost_of_committed_assignment`. Its first-note-zero behavior rewards excess voices, it
has no hard overlap penalty, uses a fixed 960-tick gap scale, includes percussion, and has no
profile version.

V1 should use the wording `assignment/model cost: lower is better under this profile`, not an
objective musical-quality grade. It may declare a lower-cost side only when the evaluator
version/profile, note universe, hard-violation status, and melodic voice count are comparable.

Exit gate: deterministic, note-order-invariant, voice-ID-invariant results on synthetic and
real fixtures, with no unsupported winner claim.

### 2. Editable side B — complete

Required work before B UI:

- Land M1-M11 as behavior-preserving foundations.
- Fork B from an immutable snapshot.
- Give each branch independent history and revision-guarded async operations.
- Define promotion/discard/save lifecycle.
- Bind inspectors and editor commands to the active branch.

Exit gate: A and B edit and undo independently; neither mutates the other or the source
snapshot; stale reruns cannot land.

### 3. Split screen — complete

Required work:

- Land M13 controlled pane and viewport state.
- Keep musical time aligned by default.
- Map linked selection through correspondence.
- Give each canvas a side-qualified accessible identity.

Exit gate: both panes stay aligned, focus is obvious, and all edits route to the active side.

### 4. Keyboard side switching — complete

Required work:

- Land M14 command registry.
- Audit existing bindings, including Brush on `B`.
- Route undo/redo and every mutation through active-side permissions.

Exit gate: switching cannot fire an editor tool, input fields remain safe, and shortcuts
cannot bypass permissions.

### 5. A/B playback — complete

Required work:

- Land M10-M12 presentation and playback-source contracts.
- Use one transport/engine.
- Preserve the current tick when switching monitored sides.
- Keep controls and monitored-side status available during switching.
- Resolve solo/scope explicitly when a voice has no correspondence.

Exit gate: render side, monitor side, timbre mapping, playhead, and transport controls cannot
diverge.

### 6. Voice-lane editing parity — automated E3 complete; manual acceptance pending

Required work:

- Land M15 geometry/capability seam.
- Add a vertical lane viewport.
- Share selection and mutation commands with the piano view.
- Document intentionally unsupported tools.

Likely common capabilities are click/shift selection, marquee, number-key reassignment,
context assignment, audition, and pencil/brush/lasso/wand operations. Pitch-range markers
remain piano-only unless separately designed.

Exit gate: common gestures produce identical editor commands in both views.

### 7. Content-based matching — in progress through the pure matcher boundary

Required work:

- Land M8, M9, and M16.
- Support exact same-document correspondence and versioned cross-document policies.
- Cover PPQ normalization, duplicates, ambiguity, and deterministic tie-breaking.

Implemented 2026-07-14: the pure Rust service now has canonical rational atoms, strict matching,
duplicate ambiguity, conservative cross-import candidate resolution with coverage gating,
same-document local-ID correspondence, and checked-in fixture coverage. It has no public command
or UI consumer yet. Feature 8 consumes only unambiguous pairs; Feature 9 consumes strict multiset
semantics.

Exit gate: input ordering does not change matches; low coverage yields `incomparable`; strict
and tolerant policies cannot be confused.

### 8. Cross-import diffing — implementation through C4

Implementation design and commit-sized slices: `CROSS_IMPORT_DIFFING_PLAN.md`. Through C4, the
app can choose, replace, retry, reopen, and close an immutable external MIDI reference while
sending the current materialized editor project to the guarded native command, then present
coverage-first diagnostics without unsafe reassignment claims, render read-only paired diff panes,
and prevent reference-side input from mutating the working copy. D1--D2 remain; Feature 6 and
Feature 8 manual acceptance are still unrecorded.

Required work:

- Land M17 reference-document ownership.
- Reuse the comparison workspace and split UI.
- Use paired note references and maximum-weight voice correspondence.
- Display match coverage and ambiguity.

Exit gate: equivalent exports compare cleanly despite regenerated IDs, unrelated imports are
refused, and ambiguous/unmatched notes remain visible.

### 9. Automated export-to-reimport verification

Required work:

- Land M18 semantic contract and project validation.
- Verify actual encoded/written output with the strict matcher.
- Resolve or report the known fidelity gaps.
- Return a structured verification DTO through real Tauri IPC.

Exit gate: `Verified` means the documented application model round-tripped; it never implies
lossless preservation of unsupported MIDI events.

## Cross-Cutting Verification Strategy

Every individual plan must define narrow tests per slice and broad checks before commit.

### Rust

- Evaluator component and invariant tests.
- Matcher exact/tolerant policy tests.
- Determinism and duplicate-multiset tests.
- Project validation and exporter/parser tests.
- Strict semantic round-trip fixtures.

### TypeScript/Vitest

- Atomic editor reducer invariants.
- Branch-local undo/redo.
- Revision-guarded async-result handling.
- Workspace target resolution.
- Maximum-weight voice correspondence and ambiguity.
- Presentation-key stability.
- Command permission and binding resolution.
- Playback-source and scope mapping.
- Piano/lane geometry parity.

### Playwright

- A/B branch isolation and snapshot immutability.
- Split-screen active-side routing.
- Side-qualified canvas accessibility.
- Keyboard focus and collision behavior.
- Visual-side/monitor-side consistency.
- Playback switching with an advancing readout and available Stop control.
- Cross-import coverage and ambiguity UI.

### Native WDIO

- Compiled WebView/Tauri command smoke coverage for new evaluator and matcher DTOs.
- Real export, reimport, and verification report through IPC.
- Sample/static-asset playback smoke coverage where appropriate.

### Manual pause points

- Cost metric usefulness on the two dense real fixtures.
- Split-screen readability and focus clarity.
- A/B switch latency, clicks, and matched-voice timbre consistency.
- Voice-lane gesture ergonomics.
- Cross-import matching quality on genuinely related but non-identical files.

## Mandatory Regression Scenarios

- Changing rerun controls does not change applied assignment provenance.
- A stale rerun cannot overwrite a newer edit or the wrong branch.
- Undo/redo changes only the active branch.
- Deleting a referenced snapshot invalidates comparison instead of silently showing A versus A.
- Matched voices retain labels, color, solo mapping, and chiptune timbre.
- Switching visual sides during playback cannot leave hidden audio running without controls.
- B-side shortcuts cannot collide with Brush or fire while typing.
- Cross-import ambiguity cannot be presented as a certain reassignment.
- Strict verification cannot use fuzzy tolerance to pass a corrupted export.
- Percussion and overlapping duplicate-note fixtures participate in round-trip verification.

## Explicitly Rejected Designs

- Parallel A/B state fields and handler trees in `App.tsx`.
- Mutable named snapshots.
- Storing materialized projects, diffs, matches, or scores in comparison state.
- Treating current dropdown values as applied assignment provenance.
- Carrying voice metadata across revisions by raw voice ID.
- Separate playback engines for A and B.
- Duplicated piano-roll and lane gesture implementations.
- Weakening the existing disjoint-ID diff guard before correspondence exists.
- Reusing tolerant cross-import matching for round-trip verification.
- Calling V1 model cost an objective musical-quality score.
- Claiming byte-identical or lossless MIDI round trips for fields the DTO does not model.

## Requirements for Each Future Detailed Plan

Create the individual plans in the master order above. Each plan must include:

- scope and explicit non-goals;
- architecture contracts from this file that it consumes;
- public types and module boundaries;
- migration strategy from the current code;
- commit-sized vertical slices;
- exactly one focused git commit per completed slice;
- narrow tests during development and broad verification before commit;
- manual trial points only where interaction or listening quality requires them;
- documentation updates;
- rollback or failure behavior for async/native operations;
- the verified boundary from which the following plan may begin.

Do not combine the individual plans into one speculative implementation roadmap. Plan and
implement one feature family at a time, beginning with the cost-based assignment metric.
