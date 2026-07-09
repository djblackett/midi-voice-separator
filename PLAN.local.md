# Revised Plan: Snapshots, Diff, Compare, Review — with Coupling Contracts Resolved

Repo: `chiptune-voice-separator` (c:\Users\davej\dev\midi-separator)
Date: 2026-07-08
Status: Slices 1-11 implemented; remaining compare/playback/editor parity ideas are deferred below.

This plan supersedes the earlier draft of the same feature set. It keeps that
draft's slice discipline and milestone order but resolves the contracts a
pre-implementation coupling review found ambiguous. Each Binding Contract below
maps to a documented past bug in `agents.md` or a verified identity-instability
fact in the codebase (note-ID format in `parser.rs:440`, voice-id reallocation
on re-run, the Phase-7 half-revert note, the range-provenance bug).

## Ground Rules

- Start each slice with `git status --short`.
- Do not mix slices in one commit.
- Narrowest tests during development, broader checks before commit
  (`pnpm test`, `pnpm lint`, `pnpm format:check`, `pnpm build`; Rust suite only
  when `src-tauri` is touched).
- Commit only with the app in a working state.
- Pause for manual trial where interaction quality matters more than unit
  coverage.

## Binding Contracts (read before any slice)

These are decisions, not open questions. Later slices reference them by number.

**C1 — A named snapshot IS an `EditorSnapshot` plus metadata.**
The snapshot type wraps the existing `EditorSnapshot` from
`src/app/editorHistory.ts` — all five fields: `project` (full, non-optional),
`voiceOverrides`, `voiceOrder`, `voiceLabels`, `rangeAssignedNoteIds` — plus
metadata: `id`, `name`, `createdAt`, `source`
(`import | manual | before-rerun | after-rerun | restore`), and the complete
re-run parameter triple `{ strategy, assignmentMode, maxVoiceCount }`. No
"maybe" fields. Rationale: restoring overrides without `project` across a
re-run boundary is the documented Phase-7 half-revert bug; restoring overrides
without `rangeAssignedNoteIds` is the documented range-provenance bug. Wrapping
(not paralleling) `EditorSnapshot` means any future field added there is
captured here for free.

**C2 — Note IDs are stable within a session, never across export/reimport.**
IDs embed the source track index (`t{track}-c{channel}-p{pitch}-s{start}-e{end}-n{seq}`);
export writes one track per voice, so reimport regenerates every ID. Therefore:
all diffing is in-session only. Any comparison where the two sides' note-ID
sets are (near-)disjoint must be detected and refused with an explanatory
message, never rendered as "all notes removed + added." No feature in this plan
may promise cross-import comparison.

**C3 — Voice IDs are not identity across re-runs; the diff engine must match
voices before counting.**
A full re-run allocates fresh `voice-N` ids (preserving only locked ids).
Before computing any "notes reassigned" / "voices added/removed" metric, pair
the two sides' voices by maximum note overlap (greedy bipartite matching on
shared note IDs is sufficient at this scale). A note counts as "reassigned"
only if it moved between _matched_ voices. Unmatched voices are the true
"added/removed." The percussion voice (`"percussion"`) is pre-matched to itself
by fixed id and excluded from the matching pool.

**C4 — `voiceOverrides` is the lock set. Say so wherever it changes.**
Restoring a snapshot rewrites which notes the next re-run treats as hard
constraints — the restore UI must state this ("also restores which notes are
locked"). Every new override-writing path (review queue, suggestions) must also
remove touched note IDs from `rangeAssignedNoteIds`, exactly like every
existing path does.

**C5 — Confidence comparisons are only meaningful within one (mode, strategy)
pair.**
`assignmentConfidence` measures local decisiveness, not quality; Global mode
measurably produces lower confidence for better assignments (see the
real-fixture validation entry in `agents.md`). The diff panel shows
confidence-delta metrics only when both sides were produced under the same
`assignmentMode` + `strategy` (available from C1 metadata); otherwise it shows
"confidence not comparable across modes" in that row. Cost-based comparison is
out of scope for now (would need a new Rust command).

**C6 — Diff operates on materialized displayed assignments.**
The compared value per note is `voiceOverrides[note.id] ?? note.voiceId` — the
same composition `displayedProject` uses — never the raw project or the
override map alone. Snapshot restore and diff both go through one shared
materialization helper.

**C7 — The percussion voice is special everywhere.**
Fixed id, outside the voice cap, label fallback in `buildVoiceList`. Diff
matching (C3), voice lanes, export readiness, and suggestions must each handle
it explicitly (usually: pin it, don't count it as added/removed, don't suggest
merging into/out of it).

---

## Slice 0: Baseline Audit

`git status --short`; re-read `App.tsx` state wiring, `editorHistory.ts`,
`handleReassign`'s closure-capture pattern, `buildScheduledNotes`,
`reviewQueue.ts`; confirm the fast checks pass. Additionally re-verify at
implementation time the two facts the contracts rest on: note-ID format in
`parser.rs` still embeds track index, and `reassign_voices` still preserves
note IDs. No commit unless scaffolding is needed.

## Slice 1: Snapshot Data Model (per C1)

Implement:

- `src/app/editorSnapshots.ts`:
  `NamedSnapshot = { id, name, createdAt, source, rerunSettings: { strategy, assignmentMode, maxVoiceCount }, state: EditorSnapshot }`.
- Pure helpers: `createNamedSnapshot(currentState, currentRerunSettings,
source, name?)`, `restoreEditorState(snapshot): EditorSnapshot` (returns the
  wrapped state; App applies it through the same code path undo/redo uses),
  default-name generation.
- Shared materialization helper
  `materializeAssignments(project, voiceOverrides): ReadonlyMap<noteId, voiceId>`
  (C6) — lives here or in `domain/midi`, used later by the diff engine.
- Tests: creation captures all five state fields + settings triple; restoration
  round-trips including `rangeAssignedNoteIds`; a restore across a simulated
  re-run (different `project` object) restores the old project, not just
  overrides — the direct regression guard for the Phase-7 half-revert bug.

Verify: `pnpm test`, `pnpm lint`.
Commit: `Add named editor snapshot model wrapping EditorSnapshot`.

## Slice 2: Snapshot UI + Auto-Snapshots

Implement:

- Compact snapshot panel: Save / Restore / Rename / Delete, list with name +
  source + timestamp.
- Auto-snapshots: `Import` (in `applyImportedProject`), `Before rerun`
  (captured **inside `handleReassign`'s existing closure**, at the same point
  `pushHistorySnapshot()` captures pre-mutation state — after the invoke
  succeeds, before `setProject`; a failed re-run creates no snapshot, matching
  the existing discipline), `After rerun`.
- Restore goes through the existing undo mechanism: push current state onto
  `editorHistory` first (the standard `pushHistorySnapshot()`), then apply the
  snapshot's `EditorSnapshot` via the same setter sequence `handleUndo` uses.
  Redo stack clears, per existing `pushHistory` semantics — restore is "a new
  action," deliberately.
- Restore confirmation copy states the lock consequence (C4): "Restores note
  assignments, voices, labels, and which notes are locked for re-runs."
- Restore does **not** silently change the Strategy/Search/Max-voices selectors
  (documented UI preferences, not corrigible state). Instead, the snapshot row
  shows its recorded settings and offers an explicit "Use these re-run
  settings" button that sets the three selectors. Settings travel with the
  snapshot but apply only on request.
- Cap or prune auto-snapshots if reruns are spammed (e.g., keep last N
  `before/after-rerun` pairs) — pick N during implementation; the point is it's
  bounded.

Verify: `pnpm test`, `pnpm lint`, `pnpm build`.
Commit: `Add snapshot management UI with rerun auto-snapshots`.
Manual trial: quick pass — specifically restore-across-a-rerun and undo-of-a-restore.

## Slice 3: Assignment Diff Engine (per C2, C3, C5, C6, C7)

Implement pure helpers in `src/domain/midi/` (or `src/app/`):

- `matchVoices(before, after): VoiceMatching` — max-overlap pairing (C3),
  percussion pre-matched (C7), returns matched pairs + unmatched-before
  (removed) + unmatched-after (added).
- `compareAssignments(before, after, matching): AssignmentDiff` over
  materialized assignments (C6): `changedNoteIds` (moved between matched
  voices), notes only-in-before / only-in-after (counted separately, never as
  "reassigned"), voices added/removed (from matching), labels changed (on
  matched pairs), locks preserved count, percussion delta.
- Confidence deltas (`improved` / `worsened` relative to
  `LOW_CONFIDENCE_THRESHOLD`) computed **only when** both sides'
  `rerunSettings` share mode + strategy (C5); otherwise the diff carries
  `confidenceComparable: false` and no numbers.
- Disjoint-ID guard (C2): if shared note IDs are below a sanity threshold
  (e.g., <50%), return a `DiffIncomparable` result with reason, instead of a
  diff.
- Tests: voice-permutation fixture (same grouping, renamed ids → zero
  reassignments reported — the direct guard against the diff lying), genuine
  reassignment fixture, disjoint-ID refusal, percussion exclusion, cross-mode
  confidence suppression, only-in-one-side counting.

Verify: `pnpm test`.
Commit: `Add voice-matched assignment diff engine`.

## Slice 4: Diff Summary Panel

Implement:

- "What changed?" panel: reassigned count, added/removed voices (by matched
  identity), label changes, locks preserved, confidence rows only when
  comparable (C5) with the "not comparable across modes" note otherwise, and
  the incomparable-sides message for the C2 refusal case.
- Comparison target selector: current vs Import / vs previous snapshot / vs
  selected snapshot. The selected diff target becomes shared state — Slices 5
  and 7 read it.

Verify: `pnpm test`, `pnpm lint`, `pnpm build`.
Commit: `Show voice-matched assignment diff summary`.
**Pause point:** manual trial on a real file — is the summary useful, and does
a strategy-change rerun read as a sane diff (not id-permutation noise)?

## Slice 5: Changed-Note Overlay in Piano Roll

Implement:

- Thread the diff's `changedNoteIds` (and a `previousVoiceId` map from the
  matching, for the color-edge cue) into `PianoRoll` → `drawPianoRoll`.
- Extend `resolveNoteRenderStyle` — and **define cue precedence explicitly in
  one place, with tests**: selection > paint preview > changed-note cue >
  low-confidence dash > solo dimming (exact order finalized during
  implementation, but it must be a single documented ordering — five cues now
  co-occur). The paint-preview rule stays: preview changes `effectiveVoiceId`,
  confidence styling stays on the real note; the changed cue keys off the diff
  map, a third independent channel — the precedence test matrix covers all
  pairwise combinations.
- "Show changes" toggle; optional "only changed notes" filter.

Verify: `pnpm test` (precedence matrix in `drawPianoRoll.test.ts`), `pnpm build`.
Commit: `Highlight changed notes in piano roll`.
**Pause point:** manual readability check — changed cue vs dashed
low-confidence outline on a dense file.

## Slice 6: A/B Compare Mode — re-scoped as read-only preview

The architectural slice; the earlier draft under-priced it. First pass commits
only to:

- Compare state: `{ baselineSnapshotId, target, viewing: "A" | "B" | "diff" }`.
- Viewing B renders B's materialized project through `PianoRoll` (a derived
  `comparedProject`, threaded as a prop — `displayedProject` is untouched and
  remains the single editable truth).
- **All editing is disabled while viewing B or diff**: paint, 1–9
  reassignment, Tab review-stepping, marker drags, voice-legend actions. A
  visible "read-only preview" banner explains why. This is the explicit
  resolution of the "editing B silently edits A" trap — deferred, not fudged.
- Legend shows B's voices with matched-pair correspondence from C3 (so "this B
  voice is that A voice, renamed").
- `soloVoiceId` is cleared or mapped through the matching while previewing B
  (it may not exist there).
- Exiting compare mode restores normal editing. "Restore B" = the Slice 2
  restore path.
- Editable-B, split-screen, and keyboard A/B toggling are explicitly deferred
  to a future plan.

Verify: tests for the compare-state helper and the editing-disabled guard
logic; `pnpm test`, `pnpm lint`, `pnpm build`.
Commit: `Add read-only A/B assignment compare preview`.
**Pause point:** manual — is the read-only preview mental model
understandable?

## Slice 7: Scoped Playback

Implement:

- Scopes: all / selected / current voice / changed notes / around current
  flagged note. **A/B-side playback is deferred** with editable-B (it inherits
  the voice-timbre instability: `waveformForVoice` keys off voice id, so B
  playback without matched-id mapping would change timbre for unmoved notes —
  solve it when B becomes interactive, not now).
- **Precedence rule, decided now:** scope and solo compose by intersection
  (scope filters first, solo filters within it); if the intersection is empty,
  the toolbar shows "no notes in scope for soloed voice" rather than playing
  silence unexplained. The rule lives in `buildScheduledNotes` — still the
  single decision point for what plays.
- "Changed notes" scope reads the Slice 4 diff target; if the current diff is
  `DiffIncomparable` or absent, the scope option is disabled with a tooltip
  (explicit dependency, not a silent no-op).
- Tests for the scope filter and the solo-intersection rule in
  `scheduledNotes.test.ts`.

Verify: `pnpm test`, `pnpm lint`, `pnpm build`.
Commit: `Add scoped playback modes`.
**Pause point:** listen to it.

## Slice 8: Review Queue 2.0 (per C4, C5)

Implement:

- Guided panel: current flagged note, next/previous (reusing
  `findNextFlaggedNoteId`), assign-to-voice, accept, skip, progress display,
  auto-pan via the existing reveal effects.
- **"Accept current" writes an override pinning the note to its current voice**
  (making it locked, per C4) and removes it from `rangeAssignedNoteIds`. This
  is the deliberate choice: accepted decisions survive re-runs
  (`UserLocked`/1.0) and drop out of the flagged queue after the next re-run.
  Button copy reflects it ("Accept & lock"). Assign-to-voice does the same
  bookkeeping by construction.
- **Progress reconciliation rule, defined now:** reviewed-ness is _derived_,
  not stored — a flagged note counts as reviewed if it has an override entry;
  "skipped" is the only stored per-session set, keyed by note ID, and it resets
  whenever `project` is replaced (re-run, restore, import). Progress reads
  `overridden-or-skipped / flagged`. This keeps the queue consistent with the
  facts that manual edits never change stored confidence and that
  `flaggedNotes` rebuilds on every project replacement — progress can shrink
  after a re-run because the re-run genuinely changed what's flagged, and the
  UI says so ("re-run updated the flagged list").
- Tests for the derivation rule, skip-reset-on-project-change, and accept's
  override + provenance bookkeeping.

Verify: `pnpm test`, `pnpm lint`, `pnpm build`.
Commit: `Add guided flagged-note review workflow`.
**Required pause:** manual trial on a real dense file, including a mid-review
re-run.

## Slice 9: Export Readiness Gate (re-scoped per C2)

Implement, advisory-only (never blocking):

- Readiness summary from state that actually exists: unresolved flagged notes
  (Slice 8's derived rule), generic voice labels, empty/tiny voices, unlocked
  changed notes since the selected baseline snapshot, percussion voice present
  (informational, per C7).
- **Dropped:** "last reimport verification status." No such state exists, and
  C2 makes ID-based automated reimport verification impossible. Reimport
  verification stays what it is today — a documented manual workflow step; the
  readiness panel may link to/remind about it, nothing more. If automated
  round-trip verification is ever wanted, it's a separate plan requiring a
  content-based (not ID-based) note-matching design and probably Rust support.
- Tests for the readiness helper. No Rust changes expected; if export DTOs are
  somehow touched, run the full Rust suite and the export/reimport check.

Verify: `pnpm test`, `pnpm build`.
Commit: `Add export readiness summary`.

## Slice 10: Voice Lane View (committed as read-only)

Implement:

- View toggle: piano roll / voice lanes. Lanes render per-voice bands, sharing
  the horizontal (tick) viewport only.
- **Committed scope: read-only + click-to-select.** Full editing parity
  (paint, marquee, marker drags) is out of scope for this slice because
  `coordinates.ts`, `hitTest.ts`, and the reveal effects assume one global
  pitch→y mapping; lanes need their own per-lane mapping and hit-test path,
  built minimally here (click-to-select only). Percussion gets a lane like any
  other voice (C7: pinned last or first, consistently).
- Extract lane layout math pure and test it; visual checks manual.

Verify: `pnpm test`, `pnpm build`.
Commit: `Add read-only voice lane inspection view`.
**Pause point:** decide whether lanes earn editing investment before any parity
work.

## Slice 11: Smart Fix Suggestions (per C4, C7)

Implement conservatively:

- Heuristics: low-confidence clusters, suspicious tiny voices, phrase split
  across two voices — each suggestion carries its human-readable reason.
- Actions only compose existing paths: select affected notes / assign to voice
  / merge — every applying action goes through the standard override-write
  bookkeeping (push history, update `rangeAssignedNoteIds`, C4).
- Never suggest merging into or out of the percussion voice (C7); never
  suggest anything touching locked notes without saying they're locked.
- Pure tests for each heuristic, including a "no suggestions on a clean file"
  case.

Verify: `pnpm test`, `pnpm lint`, `pnpm build`.
Commit: `Suggest likely correction actions`.
**Required pause:** validate suggestions on real files before trusting them.

---

## Milestone Order & Pause Points

**1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11** (export readiness ahead of
voice lanes).

Mandatory pauses: after 4 (diff usefulness, especially voice-matching quality
on a real strategy-change rerun), after 5 (overlay readability), after 6
(read-only compare mental model), after 7 (listen), after 8 (guided review
incl. mid-review rerun), after 10 (lanes go/no-go), after 11 (suggestion
quality).

## Explicitly Deferred (so nobody scope-creeps them in)

- Editable side-B / split-screen compare, and A/B playback (Slice 6/7 notes).
- Cross-import diffing and automated export→reimport verification (blocked by
  C2; needs content-based matching, its own plan).
- Cost-based quality comparison in the diff panel (needs a new Rust command
  exposing `total_cost_of_committed_assignment`-style replay; worth considering
  as the honest cross-mode metric C5 forbids confidence from being).
- Voice-lane editing parity.

## Summary of deltas from the earlier draft

Snapshots wrap the existing `EditorSnapshot` with the full project and
provenance included; the diff engine matches voices before counting and refuses
disjoint-ID comparisons; confidence deltas only appear within a matching
mode/strategy; A/B ships as read-only preview; "accept" means lock and review
progress is derived rather than stored; the reimport-verification readiness
item is dropped; voice lanes commit to read-only; and the percussion voice and
lock-set semantics are pinned as cross-cutting contracts instead of being
rediscovered slice by slice.
