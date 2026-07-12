# Detailed Plan: Editor Foundation + Editable Side B (Master-Plan Feature 2)

Repository: `chiptune-voice-separator`
Date: 2026-07-10
Consumes: `NEXT_FEATURES_MASTER_PLAN.md` (contracts M1–M11), `PLAN.local.md` (completed
snapshots/diff/compare contracts C1–C6).
Status: architecture drafted; implementation not started.
Verified entry boundary: Feature 1 (cost-based assignment metric) is complete and its exit
gate is met — 12 Rust evaluator tests (incl. dense real-fixture determinism/invariance) and 8
`assignmentMetric.ts` gate tests pass. This plan begins from commit `2844dd0`.

---

## 1. Purpose and scope

The master plan states: _"The editor/branch foundation is not a separate product feature. It
is the required first part of the editable-B plan."_ This document is that combined plan.

**In scope**

- The behavior-preserving editor foundation: atomic `EditorDocument`, one command reducer, one
  history implementation, revision-guarded async, and honest assignment provenance (M1, M3, M6,
  M7).
- The branch model that lets a second editable side exist without duplicating state (M2, M5),
  reusing the already-reference-only comparison workspace (M4) and centralized materialization.
- **Single-view** editable B: fork B from an immutable snapshot, edit and undo A and B
  independently, toggle which side the one canvas shows, and an explicit promote/discard/save
  lifecycle. This reuses the existing A/B/Diff toggle shipped in `2844dd0`.

**Explicit non-goals** (each is a later master-plan feature; do not pull them forward)

- **Split screen / simultaneous rendering of A and B** — master-plan Feature 3. Therefore the
  split-pane UI state contract **M13 is out of scope here.**
- **A/B playback of two sides** — Feature 5. The transport still plays exactly one materialized
  project at a time; we only make _which_ project that is follow the active branch (a small
  slice of M11/M12, not the full transport rework).
- **Keyboard side switching** — Feature 4. B is selected by the existing on-canvas toggle, not a
  shortcut, so we do not build the full command registry (M14) — but see §7 for the one M14
  invariant we must honor early (authorize undo/redo against the active side to close the
  known read-only-compare undo leak).
- **Voice-lane parity, content matching, cross-import, round-trip verification** — Features 6–9.

**The one genuinely open architecture decision** is the scope of M8–M11 (side-scoped IDs,
maximum-weight voice correspondence, presentation keys, workspace projection). See §4. The plan
sequences them as their own phase (Phase C) so the decision can be made deliberately without
blocking the unambiguous foundation work in Phases A–B.

---

## 2. Current baseline (verified by reading, not assumed)

Relevant to this feature, the code already has:

- **`EditorSnapshot`** (`src/app/editorHistory.ts`): `{ project, voiceOverrides, voiceOrder,
voiceLabels, rangeAssignedNoteIds }`. This is exactly the five-field atomic value M1 wants to
  promote — it just lacks identity, revision, and provenance.
- **`editorHistory.ts`**: pure, capped (50) full-snapshot `past`/`future` stacks —
  `createEditorHistory`, `pushHistory`, `undoHistory`, `redoHistory`. One implicit branch.
- **`materializeEditorProject`** (`src/domain/midi/editorMaterialization.ts`): the single
  overrides-applied, voice-list-rebuilt projection every renderer/comparison/evaluator consumes.
  This is the M4/M11 "materialized side" building block, already centralized.
- **`CompareState`** (`src/app/editorCompare.ts`): `{ baselineSnapshotId, targetSnapshotId,
viewing }` — **references only, no copied projects**, already satisfying M4's storage rule.
  `buildComparePreview` derives the projection (materialized target + `matchVoices` result).
- **`NamedSnapshot`** wraps `EditorSnapshot` + metadata and is treated as immutable (C1).
- **`matchVoices`** (`src/domain/midi/assignmentDiff.ts`): a _greedy_ largest-overlap-first voice
  matcher. M9 wants this replaced by deterministic maximum-weight bipartite matching.
- The `reassign_voices` IPC returns a bare `MidiProject` with **no provenance metadata**; the
  frontend labels snapshots and the diff with live dropdown values (the M6 bug).

The scaling risk the master plan names is real and measured: `App.tsx` holds ~39 `useState`
atoms and ~44 handlers. Five of those atoms are the editor document (`project`, `voiceOverrides`,
`voiceOrder`, `voiceLabels`, `rangeAssignedNoteIds`) plus `history`; the rest are UI/tool/async
state. The mutation pattern is uniform and is the thing to replace:

```
handleX() {
  pushHistorySnapshot();          // reads the 5 fields off the render closure
  setVoiceOverrides(...); setVoiceOrder(...); setRangeAssignedNoteIds(...); // 3–6 fan-out setters
  setExportResult(null);          // + ad-hoc side effects
}
```

`undoHistory`/`redoHistory` repeat the same six-setter fan-out. Doing editable B by copying this
into `bProject`/`bOverrides`/… is exactly the master plan's top **rejected** design.

### Bugs this foundation must fix (each maps to a contract)

- **M3** — `handleRenameVoice` does not push history; only the rename input's `onFocus` does, so
  a programmatic or non-focus rename is silently non-undoable. Number-key reassignment
  (`applyNoteReassignment`) duplicates assignment bookkeeping already expressed elsewhere.
- **M6** — `currentRerunSettings` is built from the live Strategy/Search/Max-voices selectors and
  is used both as the diff's "how this assignment was produced" side _and_ stamped onto
  before/after-rerun snapshots. Dropdown state is not provenance.
- **M7** — `handleReassign` awaits `reassign_voices` over IPC and then mutates editor state with
  no revision guard; a keyboard or canvas edit landing during the await is clobbered, and
  `pushHistorySnapshot()` captures pre-await closure values.
- **M14 (partial)** — undo/redo are not gated while a read-only compare view (B/diff) is shown,
  the documented "hidden undo leak in read-only compare."

---

## 3. Target architecture (types and boundaries)

### 3.1 The atomic document (M1)

```ts
// src/app/editor/editorDocument.ts
export type DocumentId = string;

export interface EditorDocument {
  readonly documentId: DocumentId;
  readonly revision: number; // bumped by every committed transaction
  readonly project: MidiProject | null;
  readonly voiceOverrides: VoiceOverrides;
  readonly voiceOrder: readonly string[];
  readonly voiceLabels: Readonly<Record<string, string>>;
  readonly rangeAssignedNoteIds: ReadonlySet<string>;
  readonly assignmentProvenance: AssignmentProvenance; // M6, see 3.4
}
```

Invariant enforced in one place: `rangeAssignedNoteIds ⊆ keys(voiceOverrides)` (C4/M1). The
full-project snapshot approach is kept — no note/assignment normalization store (explicitly
allowed by M1, and required by C1 so restore across a rerun boundary can't half-revert).

### 3.2 One command system (M3)

```ts
// src/app/editor/editorCommand.ts
export type EditorCommand =
  | { kind: "assignNotes"; noteIds: readonly string[]; voiceId: string }
  | { kind: "createVoice"; assignSelection?: readonly string[] }
  | { kind: "renameVoice"; voiceId: string; label: string }
  | { kind: "mergeVoice"; from: string; to: string }
  | { kind: "reorderVoice"; voiceId: string; direction: -1 | 1 }
  | { kind: "applyRangeAssignments"; assignments: ReadonlyMap<string, string> }
  | { kind: "paintNotes"; noteIds: readonly string[]; voiceId: string }
  | {
      kind: "replaceProject";
      project: MidiProject;
      provenance: AssignmentProvenance;
      voiceOrder: readonly string[];
    } // rerun / restore result application
  | { kind: "restoreDocument"; document: EditorDocument };

// The entire editor boundary, pure and total:
export function applyEditorCommand(doc: EditorDocument, cmd: EditorCommand): EditorDocument;
```

Every button, canvas gesture, review action, smart fix, snapshot restore, and rerun result goes
through `applyEditorCommand`. It is the _only_ function that mutates the five fields. It returns a
new document with `revision + 1`. Non-mutating actions (selection, solo, tool) never enter it.

This closes the M3 inconsistencies structurally: rename becomes a normal command (always
undoable), and the number-key path becomes `assignNotes` like every other assignment.

### 3.3 Branch + history (M2)

```ts
// src/app/editor/editorBranch.ts
export type BranchId = "A" | "B";

export interface EditorBranch {
  readonly branchId: BranchId;
  readonly present: EditorDocument;
  readonly history: EditorHistoryState; // reuses existing editorHistory.ts, retyped to EditorDocument
  readonly forkedFrom: SnapshotRef | null; // A = null (or import), B = the snapshot it forked
}

// history-wrapping transition used by the app for every mutation:
export function commit(branch: EditorBranch, cmd: EditorCommand): EditorBranch; // push present, apply, replace
export function undo(branch: EditorBranch): EditorBranch;
export function redo(branch: EditorBranch): EditorBranch;
```

`editorHistory.ts` is retyped from `EditorSnapshot` to `EditorDocument` (same shape of logic;
the stacks now carry identity+revision+provenance too). Both A and B use the _same_ `commit`,
the same `applyEditorCommand`, the same materializer, diagnostics, and rerun pipeline. No
B-specific fields or handlers (M2 / rejected-design guard).

### 3.4 Provenance, presets, profiles kept separate (M6)

```ts
// src/domain/midi/assignmentProvenance.ts
export type AssignmentProvenance =
  | { kind: "imported"; algorithmVersion: number } // generic import: actually Balanced+Greedy
  | { kind: "appExportedVoiceTracks" } // non-heuristic: tracks already carried voices
  | {
      kind: "reassigned";
      strategy: SeparationStrategy;
      mode: AssignmentMode;
      maxVoiceCount: number | null;
      algorithmVersion: number;
    };
```

- `AssignmentProvenance` is **produced by the backend** as part of the import/reassign result and
  carried on the document. Manual corrections (the override layer) do not rewrite it.
- `RerunPreset` = the current `separationStrategy`/`assignmentMode`/`maxVoiceCountInput` UI atoms;
  they describe the _next_ requested rerun only.
- `EvaluationProfile` = the existing `GENERAL_PURPOSE` profile from Feature 1; already separate.

The diff and snapshot labels stop reading dropdown state and read `document.assignmentProvenance`
instead. `toDiffSide` takes provenance, not `DiffRerunSettings` derived from live selectors.

### 3.5 Comparison workspace (M4) and one projection (M11, minimal here)

`CompareState` already stores references only; it is renamed/extended to the workspace shape but
kept reference-only:

```ts
// src/app/editor/comparisonWorkspace.ts
export interface ComparisonWorkspace {
  sideA: BranchId; // "A"
  sideB: BranchRef | null; // a live B branch OR a snapshot ref not yet forked
  activeSide: BranchId; // which branch edits + inspectors bind to
  viewing: "A" | "B" | "diff"; // which side the single canvas shows (single-view: monitor == viewing)
}
```

A single derived resolver returns the render target, the active editable branch, permissions, and
the materialized sides — so the current failure mode (B visible while playback/commands still hit
A) cannot occur. In this single-view feature the resolver is small; it grows into the full M11
projection when split screen (Feature 3) and A/B playback (Feature 5) land.

---

## 4. THE open decision: how much of M8–M11 lands here

Single-view editable B works correctly with **only** M8 (side-scoped identifiers) and the minimal
M11 resolver above. M9 (maximum-weight bipartite voice correspondence) and M10 (presentation
keys) change _visible_ behavior — a matched voice keeping its color/timbre across the A/B toggle —
and only become **correctness-critical** when both sides are on screen or audible at once
(Features 3 and 5).

Three options:

1. **Foundation-only correspondence (recommended).** Land M8 and the minimal resolver now. Keep
   the existing greedy `matchVoices` for the toggle's solo/label mapping (as the shipped compare
   already does). Defer the M9 bipartite upgrade and M10 presentation-key indirection to Feature 3,
   where simultaneous rendering makes globally-optimal matching and stable color/timbre actually
   observable and testable. _Rationale:_ keeps this feature's slices behavior-preserving and
   smaller; avoids building presentation-key plumbing with no on-screen consumer to validate it.
2. **Full M8–M11 now**, as the master plan's literal "land M1–M11" reading. _Cost:_ builds the
   bipartite matcher and presentation-key layer before any UI renders two sides at once, so their
   correctness is only unit-testable, not observable — higher risk of building the wrong seam.
3. **M8–M10 now, M11 projection deferred.** Middle option; least coherent (correspondence without
   the projection that consumes it).

**DECIDED: Option 1** (signed off 2026-07-10). Phase C2 is written below but **deferred to
Feature 3** unless the D3 manual trial shows a real color/timbre-instability problem across the
A/B toggle, in which case it is promoted into this feature. This is a deliberate, signed-off
deviation from a literal reading of the master plan's "land M1–M11" Feature-2 required work,
recorded here per the master plan's rule that a contract-scope change needs explicit review.

---

## 5. Migration strategy

The refactor must never present a half-migrated editor. The safe order is _introduce the pure
core behind the existing state, then flip callers, then delete the old fan-out_:

1. Build `applyEditorCommand` + `EditorDocument` as **pure modules with their own unit tests**,
   not yet wired to `App.tsx`.
2. Introduce a single `useEditorBranch` hook that owns one `EditorBranch` for A and exposes
   `dispatch(cmd)`, `undo`, `redo`, and the materialized project. Internally it can still back
   onto the existing `useState` atoms during transition, or replace them — but the _external_
   surface is the dispatch API.
3. Convert handlers one family at a time (assignment, voice management, range, paint, rerun,
   restore) from fan-out setters to `dispatch(command)`. Each conversion is one commit and is
   behavior-preserving; the existing Playwright/Vitest suites are the regression net.
4. Only once every mutation flows through `dispatch` do we add the B branch and the workspace.
5. Presentation/correspondence (Phase C) and the B UI (Phase D) come last.

No slice mixes "introduce the core" with "delete the old path" — the delete happens after the
flip is proven green.

---

## 6. Commit-sized slices

Each slice = exactly one focused commit, app working at every commit, narrow tests during, broad
checks (`pnpm test`, `pnpm lint`, `pnpm format:check`, `pnpm build`; Rust suite when `src-tauri`
changes) before commit. `git status --short` at the start of each.

### Phase A — Atomic document + one command system (behavior-preserving)

- **A1. Introduce `EditorDocument` + `applyEditorCommand` (pure, unwired).** New
  `src/app/editor/` modules and a thorough reducer test suite covering each command and the
  `rangeAssignedNoteIds ⊆ overrides` invariant. No `App.tsx` change yet. _Tests:_ new
  `editorCommand.test.ts`.
- **A2. Retype `editorHistory.ts` to `EditorDocument`; add `commit/undo/redo`.** Update
  `editorHistory.test.ts`. Still unwired.
- **A3. Add `useEditorBranch` hook and route the assignment + paint handlers through it.**
  `applyNoteReassignment`, number-key path, and `onPaintNotes` become `dispatch({kind:"assignNotes"|"paintNotes"})`. Delete their fan-out. _Regression:_ existing
  selection/paint Playwright specs.
- **A4. Route voice-management handlers** (`createVoice`, `renameVoice`, `mergeVoice`,
  `reorderVoice`) through dispatch. **Fixes the M3 rename-history bug** — rename is now a normal
  undoable command; drop the `onFocus` snapshot hack. _Tests:_ add a Vitest/Playwright case that
  rename is undoable.
- **A5. Route range-assignment + snapshot restore + undo/redo** through the branch. Undo/redo
  stop being six-setter fan-outs and become `undo(branch)`/`redo(branch)`.
- **A6. Delete `pushHistorySnapshot`, `editorSnapshotFromCurrent` fan-out, and the loose editor
  `useState` atoms** now that the branch owns them. This is the "scaling risk" reduction; App.tsx
  editor state collapses to one branch object. Pure cleanup commit.

_Phase A verified boundary:_ every editor mutation flows through `applyEditorCommand`; all
existing tests green; rename is undoable; no behavior change otherwise.

### Phase B — Provenance, revision guard (behavior-correcting foundations)

- **B1. Backend `AssignmentProvenance` on import/reassign.** `reassign_voices` and `import_midi`
  return provenance (Rust DTO + TS type). Generic import reports `imported`/app-exported reports
  `appExportedVoiceTracks`/rerun reports the actual `reassigned{…}`. _Tests:_ Rust command tests;
  `commands.ts` typing.
- **B2. Carry provenance on the document; diff + snapshot labels read it, not dropdowns.**
  Removes the M6 bug. `toDiffSide` takes provenance. _Tests:_ `assignmentDiff`/`editorCompare`
  tests updated to assert provenance-sourced labels; a regression test that changing a dropdown
  without rerunning does not change the diff's provenance.
- **B3. Revision-guarded async rerun (M7).** `handleReassign` captures `{branchId, revision,
requestId}` before the await and applies the `replaceProject` command only if the branch is
  still at that revision; otherwise it discards into an explicit "your edit during rerun was
  kept; rerun result dropped — rerun again" path. _Tests:_ a Vitest test driving a stale result;
  a Playwright test editing during a slow faked rerun.

_Phase B verified boundary:_ dropdown state is provably not provenance; a stale rerun cannot
overwrite a newer edit (mandatory regression scenario satisfied).

### Phase C — Side-scoped identity + correspondence _(scope per §4 decision)_

- **C1. Side-scoped identifiers (M8).** Introduce `NoteRef`/`VoiceRef` types; keep parser note
  IDs as local addresses. No behavior change; this is the typing seam later features consume.
- **C2. (Option-1 default: deferred to Feature 3.)** Maximum-weight bipartite voice
  correspondence (M9) replacing greedy `matchVoices`, and presentation keys (M10). _Written here
  as a ready sub-plan but not implemented unless §10 sign-off promotes it._

### Phase D — The B branch and editable-B lifecycle

- **D1. Comparison workspace type (M4/M5) replacing `CompareState`,** reference-only, with
  `activeSide`. Behavior-preserving rename + the shipped A/B/Diff toggle rebound to it.
- **D2. Fork B from a snapshot (M5).** "Edit this snapshot as B" forks the immutable
  `NamedSnapshot` into a live `EditorBranch` with independent history. Source snapshot stays
  immutable (regression test asserts it). Editing is enabled on B; the read-only banner logic
  now means "viewing a side you are not the active editor of," not "any B/diff."
- **D3. Independent A/B editing + undo, bound to `activeSide` (M2/M11).** All inspectors and
  editor commands target the active branch. **Undo/redo authorized against the active side —
  closes the M14 read-only-compare undo leak** (the one M14 invariant we honor now). _Tests:_
  Playwright — edit A, switch to B, edit B, undo only affects B; neither mutates the other or the
  source snapshot.
- **D4. Lifecycle: `Use B` / `Keep A` / `Save B as snapshot` / safe exit (M5).** `Use B` promotes
  B to the primary result and preserves A as a snapshot; `Keep A` discards B only after an
  explicit confirm when B is dirty; exiting comparison never silently loses B. Export identifies
  the exported branch explicitly (not "whatever rendered last"). _Tests:_ Playwright lifecycle
  matrix.

_Phase D verified boundary (feature exit gate, per master plan):_ A and B edit and undo
independently; neither mutates the other or the source snapshot; stale reruns cannot land.

---

## 7. Contracts consumed, and where each is satisfied

| Contract                      | Satisfied by     | Notes                                                             |
| ----------------------------- | ---------------- | ----------------------------------------------------------------- |
| M1 atomic document            | A1, A6           | provenance field added in B1/B2                                   |
| M2 one branch type/command    | A2–A6, D1        |                                                                   |
| M3 pure transaction           | A1, A3–A5        | fixes rename-history + number-key duplication                     |
| M4 references-only comparison | D1               | already largely true today                                        |
| M5 branch lifecycle           | D2, D4           |                                                                   |
| M6 provenance separation      | B1, B2           | fixes dropdown-as-provenance                                      |
| M7 revision-guarded async     | B3               |                                                                   |
| M8 side-scoped IDs            | C1               |                                                                   |
| M9 correspondence             | C2               | **deferred by default — §4/§10**                                  |
| M10 presentation keys         | C2               | **deferred by default — §4/§10**                                  |
| M11 workspace projection      | D1, D3 (minimal) | full projection at Feature 3                                      |
| M14 (undo authorization only) | D3               | full command registry is Feature 4                                |
| M13 split panes               | —                | out of scope (Feature 3)                                          |
| M12 dual-source playback      | —                | out of scope (Feature 5); here transport just follows active side |

---

## 8. Verification strategy

- **Vitest:** reducer invariants per command (A1); branch-local undo/redo (A2, D3);
  revision-guarded stale-result handling (B3); provenance-sourced diff labels (B2); workspace
  target resolution (D1, D3).
- **Playwright:** rename undo (A4); edit-during-rerun keeps the edit (B3); B forks immutably and
  A/B undo isolation (D2, D3); lifecycle promote/discard/save and export-branch identity (D4);
  read-only/active-side routing (D3).
- **Rust:** provenance on import/reassign command results (B1).
- **Manual pause points:** after A6 (confirm no editor regressions in real use on the two dense
  fixtures); after D3 (A/B switch clarity); after D4 (no silent B loss on any exit path). If, at
  the D3 manual trial, matched-voice color/timbre visibly jump across the toggle, that is the
  trigger to promote Phase C2 (M9/M10) into this feature instead of Feature 3.

### Mandatory regression scenarios (from the master plan) exercised here

- Changing rerun controls does not change applied provenance — B2.
- A stale rerun cannot overwrite a newer edit or the wrong branch — B3.
- Undo/redo change only the active branch — D3.
- Deleting a referenced snapshot invalidates comparison rather than showing A-vs-A — D1/D2
  (extends the existing `handleDeleteSnapshot` guard to the workspace).
- B-side editing never mutates the source snapshot — D2.

---

## 9. Rollback / failure behavior

- Async rerun (B3): on stale revision, the result is dropped and the user is told to rerun; the
  branch is never left partially applied.
- Fork B (D2): failure to materialize the snapshot leaves A untouched and B unopened.
- `Use B` promotion (D4): implemented as a single `restoreDocument`/`replaceProject` command on A
  so it is itself one undoable transaction; a failure leaves A as it was.

---

## 10. Decisions needed before implementation

1. **M9/M10 scope (§4). RESOLVED 2026-07-10 — Option 1:** defer the bipartite matcher and
   presentation keys to Feature 3; keep the greedy matcher for the single-view toggle. Promote
   into this feature only if the D3 manual trial shows toggle color/timbre instability.
2. **Provenance production site (B1).** Confirm the backend (not the frontend) is where
   `AssignmentProvenance` is minted, including a non-heuristic kind for app-exported voice tracks.
3. **Plan-file home.** This lives at repo root beside `NEXT_FEATURES_MASTER_PLAN.md` and
   `PLAN.local.md`; confirm that is the intended convention for per-feature detailed plans.

---

## 11. Verified boundary this plan hands to Feature 3 (split screen)

On completion: one `EditorDocument`/command/history/materializer; a real second editable branch
with isolated history and lifecycle; a reference-only comparison workspace with an `activeSide`
resolver; honest provenance; revision-guarded async. Feature 3 then adds M13 pane state and the
full M11 projection, and (if not already promoted) M9/M10, to render A and B simultaneously.
